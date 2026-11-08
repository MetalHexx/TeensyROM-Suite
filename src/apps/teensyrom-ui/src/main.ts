import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { runInInjectionContext, inject } from '@angular/core';
import { AppBootstrapService } from '@teensyrom-nx/app/bootstrap';
import { TransferPlaybackGuard } from '@teensyrom-nx/application';
import { LogType, logInfo, logError } from '@teensyrom-nx/utils';
import { startUnlessSenderPath } from '@teensyrom-nx/asid-sender-protocol';

async function bootstrap() {
  logInfo(LogType.Start, 'Starting application bootstrap...');

  // Create application instance - this allows UI to render
  const app = await bootstrapApplication(AppComponent, appConfig);

  // Run bootstrap initialization in the injection context (non-blocking for UI)
  runInInjectionContext(app.injector, () => {
    const bootstrapService = inject(AppBootstrapService);
    bootstrapService.init().catch((error) => {
      logError('Failed to initialize application:', error);
    });

    // Constructing this forces its guarding effect() to run for the lifetime of the app,
    // independent of whether the user ever visits the player route for the device.
    inject(TransferPlaybackGuard);
  });
}

// A server answers a path it does not have with the app, so a frame meant for the sender can land here. Start nothing.
startUnlessSenderPath(window.location.pathname, () => {
  logInfo(LogType.Info, 'About to bootstrap application...');
  bootstrap().catch((err) => logError('Bootstrap failed:', err));
});
