import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatSlideToggle, MatSlideToggleModule } from '@angular/material/slide-toggle';
import {
  ConfirmationDialogComponent,
  DropdownDialogComponent,
  IconButtonComponent,
  TooltipConfig,
  TooltipDirective,
  TooltipPosition,
} from '@teensyrom-nx/ui/components';
import { WatchFolder, WatchFolderFileTypesChange, WatchFolderState } from '@teensyrom-nx/domain';

/**
 * One watched folder: its path clipped from the left so the folder name stays visible, the
 * on/off switch and the delete button, which asks before it emits, then its two file-type
 * switches. A folder that cannot be watched says so underneath.
 */
@Component({
  selector: 'lib-watch-folder-row',
  imports: [
    MatSlideToggleModule,
    IconButtonComponent,
    TooltipDirective,
    DropdownDialogComponent,
    ConfirmationDialogComponent,
  ],
  templateUrl: './watch-folder-row.component.html',
  styleUrl: './watch-folder-row.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WatchFolderRowComponent {
  readonly folder = input.required<WatchFolder>();
  /** Whether a change to this folder is in flight; holds the controls still. */
  readonly pending = input(false);

  /** Emits the new on/off state when the switch is toggled. */
  readonly enabledChange = output<boolean>();
  /** Emits the file-type switch that was toggled, with its new state. */
  readonly fileTypesChange = output<WatchFolderFileTypesChange>();
  /** Emits once the user has confirmed stopping the watch. */
  readonly deleteConfirmed = output<void>();

  protected readonly WatchFolderState = WatchFolderState;

  protected readonly enableTooltip: TooltipConfig = {
    body: 'Turn watching this folder on or off.',
    position: TooltipPosition.Left,
  };
  protected readonly allTypesTooltip: TooltipConfig = {
    body: 'Send every file that lands in this folder, not only the types the TeensyROM recognizes.',
    position: TooltipPosition.Top,
  };
  protected readonly allTypesInArchivesTooltip: TooltipConfig = {
    body: 'Send everything inside archives that land in this folder, not only the types the TeensyROM recognizes.',
    position: TooltipPosition.Top,
  };
  protected readonly deleteTooltip: TooltipConfig = {
    body: 'Stop watching this folder.',
    position: TooltipPosition.Left,
  };

  /**
   * The slide toggle flips itself before it emits, but the engine decides the folder's state: put
   * the switch back to the folder's real state and let the folder input move it once the engine
   * accepts, so a refused change leaves it where it was.
   */
  protected onToggle(toggle: MatSlideToggle, checked: boolean): void {
    toggle.checked = this.folder().enabled;
    this.enabledChange.emit(checked);
  }

  /** Like `onToggle`: the switch returns to the folder's saved value until the engine accepts. */
  protected onFileTypeToggle(
    toggle: MatSlideToggle,
    key: keyof WatchFolderFileTypesChange,
    checked: boolean
  ): void {
    toggle.checked = this.folder()[key];
    this.fileTypesChange.emit({ [key]: checked });
  }
}
