import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { PreferencesService } from '@teensyrom-nx/ui/styles';
import { Mock, vi } from 'vitest';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DirectoryNavigateComponent } from './directory-navigate.component';
import { IconButtonComponent } from '../../icon-button/icon-button.component';

describe('DirectoryNavigateComponent', () => {
  let component: DirectoryNavigateComponent;
  let fixture: ComponentFixture<DirectoryNavigateComponent>;
  let confirmReindex: WritableSignal<boolean>;
  let preferences: { confirmReindex: WritableSignal<boolean>; setConfirmReindex: Mock };

  beforeEach(async () => {
    confirmReindex = signal(true);
    preferences = { confirmReindex, setConfirmReindex: vi.fn() };

    await TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: PreferencesService, useValue: preferences },
      ],
      imports: [DirectoryNavigateComponent, IconButtonComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DirectoryNavigateComponent);
    component = fixture.componentInstance;
  });

  describe('Component Initialization', () => {
    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should have default input values', () => {
      expect(component.canNavigateUp()).toBe(false);
      expect(component.canNavigateBack()).toBe(false);
      expect(component.canNavigateForward()).toBe(false);
      expect(component.isLoading()).toBe(false);
    });
  });

  describe('Input Properties', () => {
    it('should update canNavigateUp input', () => {
      fixture.componentRef.setInput('canNavigateUp', true);
      expect(component.canNavigateUp()).toBe(true);

      fixture.componentRef.setInput('canNavigateUp', false);
      expect(component.canNavigateUp()).toBe(false);
    });

    it('should update canNavigateBack input', () => {
      fixture.componentRef.setInput('canNavigateBack', true);
      expect(component.canNavigateBack()).toBe(true);

      fixture.componentRef.setInput('canNavigateBack', false);
      expect(component.canNavigateBack()).toBe(false);
    });

    it('should update canNavigateForward input', () => {
      fixture.componentRef.setInput('canNavigateForward', true);
      expect(component.canNavigateForward()).toBe(true);

      fixture.componentRef.setInput('canNavigateForward', false);
      expect(component.canNavigateForward()).toBe(false);
    });

    it('should update isLoading input', () => {
      fixture.componentRef.setInput('isLoading', true);
      expect(component.isLoading()).toBe(true);

      fixture.componentRef.setInput('isLoading', false);
      expect(component.isLoading()).toBe(false);
    });
  });

  describe('Event Handler Methods', () => {
    it('should emit backClicked when onBackClick is called', () => {
      let emitted = false;
      component.backClicked.subscribe(() => (emitted = true));

      component.onBackClick();

      expect(emitted).toBe(true);
    });

    it('should emit forwardClicked when onForwardClick is called', () => {
      let emitted = false;
      component.forwardClicked.subscribe(() => (emitted = true));

      component.onForwardClick();

      expect(emitted).toBe(true);
    });

    it('should emit upClicked when onUpClick is called', () => {
      let emitted = false;
      component.upClicked.subscribe(() => (emitted = true));

      component.onUpClick();

      expect(emitted).toBe(true);
    });

  });

  describe('Re-index button', () => {
    let emitted: number;

    function dialogButtons(): HTMLButtonElement[] {
      return Array.from(
        document.querySelectorAll<HTMLButtonElement>('lib-confirmation-dialog lib-action-button button')
      );
    }

    beforeEach(() => {
      emitted = 0;
      component.refreshClicked.subscribe(() => emitted++);
      fixture.componentRef.setInput('path', '/games/');
      fixture.detectChanges();
    });

    afterEach(() => {
      TestBed.inject(MatDialog).closeAll();
    });

    it('opens the warning and emits nothing until confirmed', () => {
      component.onRefreshClick();
      fixture.detectChanges();

      const dialog = document.querySelector('lib-confirmation-dialog');
      expect(dialog?.textContent).toContain('Re-index this folder?');
      expect(dialog?.textContent).toContain('/games/');
      expect(dialog?.textContent).toContain("Don't ask again");
      expect(emitted).toBe(0);
    });

    it('emits and closes on confirm, leaving the preference alone without the toggle', () => {
      component.onRefreshClick();
      fixture.detectChanges();

      dialogButtons()[1].click();

      expect(emitted).toBe(1);
      expect(preferences.setConfirmReindex).not.toHaveBeenCalled();
      expect(TestBed.inject(MatDialog).openDialogs.length).toBe(0);
    });

    it('emits nothing and closes on cancel', () => {
      component.onRefreshClick();
      fixture.detectChanges();

      dialogButtons()[0].click();

      expect(emitted).toBe(0);
      expect(preferences.setConfirmReindex).not.toHaveBeenCalled();
      expect(TestBed.inject(MatDialog).openDialogs.length).toBe(0);
    });

    it('saves "Don\'t ask again" when confirmed with the toggle on', () => {
      component.onRefreshClick();
      fixture.detectChanges();

      document.querySelector<HTMLButtonElement>('lib-confirmation-dialog mat-slide-toggle button')?.click();
      fixture.detectChanges();
      dialogButtons()[1].click();

      expect(preferences.setConfirmReindex).toHaveBeenCalledWith(false);
      expect(emitted).toBe(1);
    });

    it('does not save the preference when the toggle is on but the dialog is cancelled', () => {
      component.onRefreshClick();
      fixture.detectChanges();

      document.querySelector<HTMLButtonElement>('lib-confirmation-dialog mat-slide-toggle button')?.click();
      fixture.detectChanges();
      dialogButtons()[0].click();

      expect(preferences.setConfirmReindex).not.toHaveBeenCalled();
    });

    it('emits at once, with no dialog, when the warning is switched off', () => {
      confirmReindex.set(false);

      component.onRefreshClick();

      expect(emitted).toBe(1);
      expect(document.querySelector('lib-confirmation-dialog')).toBeNull();
    });
  });
});
