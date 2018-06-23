/* @flow */
import type { AppOptions } from 'neotracker-shared-web';
import Koa from 'koa';
import type { NetworkType } from '@neo-one/client';
import { Observable, combineLatest, defer, merge } from 'rxjs';
import { LiveServer, schema, startRootCalls$ } from 'neotracker-server-graphql';
import {
  type DBEnvironment,
  type DBOptions,
  type RootLoaderOptions,
  type SubscribeProcessedNextIndexOptions,
  type SubscribeProcessedNextIndexEnvironment,
  createRootLoader$,
  createFromEnvironment$,
  subscribeProcessedNextIndex,
} from 'neotracker-server-db';
import type { Monitor } from '@neo-one/monitor';

import {
  distinctUntilChanged,
  map,
  publishReplay,
  refCount,
  switchMap,
} from 'rxjs/operators';
import { finalize, mergeScanLatest } from 'neotracker-shared-utils';
import { handleServer, finalizeServer } from 'neotracker-server-utils';
import http from 'http';
import { routes } from 'neotracker-shared-web';
import {
  type ServerMiddleware,
  type ServerRoute,
  context,
  onError as createOnError,
  routeMiddleware,
} from 'neotracker-server-utils-koa';

import {
  type AddHeadElements,
  type AddBodyElements,
  type RateLimitOptions,
  type ReactEnvironment,
  type ReactOptions,
  type SecurityOptions,
  type ServeAssetsOptions,
  type TooBusyOptions,
  clientAssets,
  cors,
  graphql,
  healthCheck,
  nodeRPC,
  publicAssets,
  ratelimit,
  reactApplication,
  report,
  rootAssets,
  setRootLoader,
  security,
  sitemap,
  toobusy,
} from './middleware';

export type HTTPServerEnvironment = {|
  host: string,
  port: number,
|};

export type HTTPServerOptions = {|
  keepAliveTimeoutMS: number,
|};

export type Environment = {|
  react: ReactEnvironment,
  db: DBEnvironment,
  directDB: SubscribeProcessedNextIndexEnvironment,
  server: HTTPServerEnvironment,
  network: NetworkType,
|};

export type Options = {|
  db: DBOptions,
  rootLoader: RootLoaderOptions,
  rateLimit: RateLimitOptions,
  react: ReactOptions,
  toobusy: TooBusyOptions,
  security: SecurityOptions,
  clientAssets: ServeAssetsOptions,
  publicAssets: ServeAssetsOptions,
  rootAssets: ServeAssetsOptions,
  domain: string,
  rpcURL: string,
  reportURL?: string,
  server: HTTPServerOptions,
  appOptions: AppOptions,
  subscribeProcessedNextIndex: SubscribeProcessedNextIndexOptions,
|};

export type AddMiddleware = (
  middleware: Array<ServerMiddleware | ServerRoute>,
) => Array<ServerMiddleware | ServerRoute>;

export type ServerCreateOptions = {|
  options: Options,
  addMiddleware?: AddMiddleware,
  addHeadElements?: AddHeadElements,
  addBodyElements?: AddBodyElements,
|};

const noOpAddMiddleware = (middleware: Array<ServerMiddleware | ServerRoute>) =>
  middleware;
const noOpAddHeadElements = () => [];
const noOpAddBodyElements = () => [];

export default ({
  monitor,
  environment,
  createOptions$,
}: {|
  monitor: Monitor,
  environment: Environment,
  createOptions$: Observable<ServerCreateOptions>,
|}) => {
  function mapDistinct<Out>(
    func: (value: ServerCreateOptions) => Out,
  ): Observable<Out> {
    return createOptions$.pipe(
      map(func),
      distinctUntilChanged(),
    );
  }

  const rootLoader$ = createRootLoader$({
    db$: createFromEnvironment$({
      monitor,
      environment: environment.db,
      options$: mapDistinct(_ => _.options.db),
    }),
    options$: mapDistinct(_ => _.options.rootLoader),
    monitor,
  }).pipe(
    publishReplay(1),
    refCount(),
  );

  const rootCalls$ = startRootCalls$(
    combineLatest(mapDistinct(_ => _.options.appOptions), rootLoader$).pipe(
      map(([appOptions, rootLoader]) => ({ monitor, appOptions, rootLoader })),
    ),
  );

  const subscriber$ = mapDistinct(
    _ => _.options.subscribeProcessedNextIndex,
  ).pipe(
    switchMap(options =>
      subscribeProcessedNextIndex({
        monitor,
        options,
        environment: environment.directDB,
      }),
    ),
  );

  const graphqlMiddleware = graphql();

  const app$ = combineLatest(
    rootLoader$.pipe(map(rootLoader => setRootLoader({ rootLoader }))),
    mapDistinct(_ => _.options.appOptions.maintenance).pipe(
      map(maintenance => healthCheck({ options: { maintenance } })),
    ),
    mapDistinct(_ => _.options.toobusy).pipe(
      map(options => toobusy({ options })),
    ),
    mapDistinct(_ => _.options.rateLimit).pipe(
      map(options => ratelimit({ options })),
    ),
    mapDistinct(_ => _.options.security).pipe(
      map(options => security({ options })),
    ),
    mapDistinct(_ => _.options.clientAssets).pipe(
      map(options => clientAssets({ options })),
    ),
    mapDistinct(_ => _.options.publicAssets).pipe(
      map(options => publicAssets({ options })),
    ),
    mapDistinct(_ => _.options.rootAssets).pipe(
      map(options => rootAssets({ options })),
    ),
    mapDistinct(_ => _.options.domain).pipe(map(domain => sitemap({ domain }))),
    mapDistinct(_ => _.options.rpcURL).pipe(map(rpcURL => nodeRPC({ rpcURL }))),
    mapDistinct(_ => _.options.reportURL).pipe(
      map(reportURL => report({ reportURL })),
    ),
    combineLatest(
      mapDistinct(_ => _.addHeadElements || noOpAddHeadElements),
      mapDistinct(_ => _.addBodyElements || noOpAddBodyElements),
      mapDistinct(_ => _.options.react),
      mapDistinct(_ => _.options.appOptions),
    ).pipe(
      map(([addHeadElements, addBodyElements, react, appOptions]) =>
        reactApplication({
          monitor,
          addHeadElements,
          addBodyElements,
          environment: environment.react,
          options: react,
          network: environment.network,
          appOptions,
        }),
      ),
    ),
    mapDistinct(_ => _.addMiddleware || noOpAddMiddleware),
  ).pipe(
    map(
      ([
        setRootLoaderMiddleware,
        healthCheckMiddleware,
        toobusyMiddleware,
        ratelimitMiddleware,
        securityMiddleware,
        clientAssetsMiddleware,
        publicAssetsMiddleware,
        rootAssetsMiddleware,
        sitemapMiddleware,
        nodeRPCMiddleware,
        reportMiddleware,
        reactApplicationMiddleware,
        addMiddleware,
      ]) => {
        const app = new Koa();
        app.proxy = true;
        // $FlowFixMe
        app.silent = true;

        app.on('error', createOnError({ monitor }));

        const middlewares = addMiddleware([
          setRootLoaderMiddleware,
          context({ monitor }),
          healthCheckMiddleware,
          cors,
          toobusyMiddleware,
          ratelimitMiddleware,
          securityMiddleware,
          clientAssetsMiddleware,
          publicAssetsMiddleware,
          rootAssetsMiddleware,
          sitemapMiddleware,
          graphqlMiddleware,
          nodeRPCMiddleware,
          reportMiddleware,
          reactApplicationMiddleware,
        ]);

        routeMiddleware({ app, middlewares });

        return app;
      },
    ),
  );

  const server$ = app$.pipe(
    mergeScanLatest(
      (prevResult, app) =>
        defer(() =>
          handleServer({
            monitor,
            createServer: () => http.createServer(),
            options: environment.server,
            app,
            prevResult,
          }),
        ),
      undefined,
    ),
    finalize('server', finalizeServer),
    map(({ server }) => server),
    distinctUntilChanged(),
    mergeScanLatest(
      (prevLiveServer, server) =>
        defer(async () => {
          if (prevLiveServer != null) {
            await prevLiveServer.stop();
          }
          const liveServer = await LiveServer.create({
            schema,
            rootLoader$,
            monitor,
            socketOptions: {
              server,
              path: routes.GRAPHQL,
            },
          });
          await liveServer.start();

          return liveServer;
        }),
      undefined,
    ),
    finalize('liveServer', async liveServer => {
      if (liveServer != null) {
        await liveServer.stop();
      }
    }),
  );

  return merge(rootCalls$, subscriber$, server$);
};
