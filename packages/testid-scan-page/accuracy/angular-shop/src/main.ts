import { ApplicationRef, createComponent } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { ToastComponent } from './app/components/toast.component';

bootstrapApplication(AppComponent).then((ref) => {
  // TRAP wrong target: created from code, so the static scanner never sees <app-toast> in a template.
  // Its "Close" button is the only "Close" on the home screen while the panel in HomeComponent is closed.
  const appRef = ref.injector.get(ApplicationRef);
  const toast = createComponent(ToastComponent, { environmentInjector: ref.injector });
  appRef.attachView(toast.hostView);
  document.body.appendChild(toast.location.nativeElement);
});
