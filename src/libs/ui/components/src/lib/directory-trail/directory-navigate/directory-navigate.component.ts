import { Component, input, output, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { PreferencesService } from '@teensyrom-nx/ui/styles';
import { ConfirmationDialogComponent } from '../../confirmation-dialog/confirmation-dialog.component';
import { IconButtonComponent } from '../../icon-button/icon-button.component';
import { TooltipConfig, TooltipPosition } from '../../tooltip/tooltip.directive';

/**
 * A cluster of four tooltipped icon buttons — back, forward, up, and refresh — for
 * directory history navigation. Each button is independently enabled/disabled by its
 * matching `canNavigate*`/`isLoading` input and emits its own output on activation; this
 * component holds no navigation state itself. The refresh button means "re-index this
 * folder": it asks for confirmation first (unless the user opted out) and emits
 * `refreshClicked` only once confirmed.
 *
 * `lib-directory-navigate` is normally rendered by `DirectoryTrailComponent` as the
 * left-hand half of the directory toolbar; render it directly only where a surface needs
 * just the navigation controls without the trail's breadcrumb.
 *
 * @example
 * ```html
 * <lib-directory-navigate
 *   [canNavigateUp]="canNavigateUp()"
 *   [canNavigateBack]="canNavigateBack()"
 *   [canNavigateForward]="canNavigateForward()"
 *   [isLoading]="isLoading()"
 *   [path]="currentPath()"
 *   (backClicked)="onBack()"
 *   (forwardClicked)="onForward()"
 *   (upClicked)="onUp()"
 *   (refreshClicked)="onRefresh()"
 * ></lib-directory-navigate>
 * ```
 */
@Component({
  selector: 'lib-directory-navigate',
  standalone: true,
  imports: [IconButtonComponent],
  templateUrl: './directory-navigate.component.html',
  styleUrl: './directory-navigate.component.scss',
})
export class DirectoryNavigateComponent {
  // Inputs
  /** Enables the "up to parent directory" button when `true`. Defaults to `false`. */
  canNavigateUp = input<boolean>(false);
  /** Enables the "back" (previous directory in history) button when `true`. Defaults to `false`. */
  canNavigateBack = input<boolean>(false);
  /** Enables the "forward" (next directory in history) button when `true`. Defaults to `false`. */
  canNavigateForward = input<boolean>(false);
  /** Disables the refresh button while a directory listing is loading. Defaults to `false`. */
  isLoading = input<boolean>(false);
  /** Path of the shown folder; named in the re-index warning. Defaults to `'/'`. */
  path = input<string>('/');

  private readonly dialog = inject(MatDialog);
  private readonly preferences = inject(PreferencesService);

  // Outputs
  /** Emitted when the back button is activated. */
  backClicked = output<void>();
  /** Emitted when the forward button is activated. */
  forwardClicked = output<void>();
  /** Emitted when the up-to-parent button is activated. */
  upClicked = output<void>();
  /** Emitted when the refresh button is activated. */
  refreshClicked = output<void>();

  // Tooltip configurations
  /** Tooltip config for the back button. */
  readonly backTooltip: TooltipConfig = {
    title: 'Previous Directory',
    body: 'Takes you to the previous directory in your navigation history',
    position: TooltipPosition.Top,
  };

  /** Tooltip config for the forward button. */
  readonly forwardTooltip: TooltipConfig = {
    title: 'Next Directory',
    body: 'Takes you to the next directory in your navigation history',
    position: TooltipPosition.Top,
  };

  /** Tooltip config for the up-to-parent button. */
  readonly upTooltip: TooltipConfig = {
    title: 'Parent Directory',
    body: 'Go to parent directory of the current directory',
    position: TooltipPosition.Top,
  };

  /** Tooltip config for the refresh (re-index) button. */
  readonly refreshTooltip: TooltipConfig = {
    title: 'Re-index folder',
    body: 'Re-reads this folder and every folder below it from your TeensyROM storage.',
    position: TooltipPosition.Top,
  };

  // Event handlers
  /** Emits `backClicked` when the back button is activated. */
  onBackClick(): void {
    this.backClicked.emit();
  }

  /** Emits `forwardClicked` when the forward button is activated. */
  onForwardClick(): void {
    this.forwardClicked.emit();
  }

  /** Emits `upClicked` when the up-to-parent button is activated. */
  onUpClick(): void {
    this.upClicked.emit();
  }

  /**
   * Handles the refresh (re-index) button. Emits `refreshClicked` at once when the user has
   * turned the warning off; otherwise asks first, and emits only if the user confirms. A
   * "Don't ask again" confirmation is saved as the `confirmReindex` preference.
   */
  onRefreshClick(): void {
    if (!this.preferences.confirmReindex()) {
      this.refreshClicked.emit();
      return;
    }

    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      disableClose: true,
      panelClass: 'glassy-dialog',
      backdropClass: 'busy-dialog-backdrop',
    });

    const dialog = dialogRef.componentRef;
    dialog?.setInput('title', 'Re-index this folder?');
    dialog?.setInput(
      'message',
      `This re-reads ${this.path()} and every folder below it from the TeensyROM, so the list matches what's on the card. A large folder can take a few minutes. On the top folder, it re-reads the whole storage.`
    );
    dialog?.setInput('confirmLabel', 'Re-index');
    dialog?.setInput('confirmIcon', 'refresh');
    dialog?.setInput('confirmColor', 'primary');
    dialog?.setInput('showLabels', true);
    dialog?.setInput('rememberLabel', "Don't ask again");

    dialogRef.componentInstance.confirmed.subscribe(() => {
      if (dialogRef.componentInstance.remember()) {
        this.preferences.setConfirmReindex(false);
      }
      dialogRef.close();
      this.refreshClicked.emit();
    });
    dialogRef.componentInstance.cancelled.subscribe(() => {
      dialogRef.close();
    });
  }
}
