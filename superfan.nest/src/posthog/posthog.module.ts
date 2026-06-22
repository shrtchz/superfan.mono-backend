import { Global, Module, Provider } from '@nestjs/common';
import { PostHog } from 'posthog-node';


const PostHogProvider: Provider = {
  provide: PostHog,
  useValue: new PostHog('phc_ho5i18afMJlHWN1xrQypW9MxdlAKBaVIxu5wXudt6uB', {
    host: 'https://us.i.posthog.com',
  }),
};

@Global() // Makes PostHog instance available throughout the app
@Module({
  providers: [PostHogProvider],
  exports: [PostHogProvider],
})
export class PosthogModule {}
