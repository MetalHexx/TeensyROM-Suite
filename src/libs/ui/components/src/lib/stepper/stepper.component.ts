import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

/** The glyph pair the buttons draw: `arrows` for moving through items, `signs` for a value. */
export type StepperGlyphs = 'arrows' | 'signs';

const GLYPHS: Record<StepperGlyphs, { previous: string; next: string }> = {
  arrows: { previous: '◀', next: '▶' },
  signs: { previous: '−', next: '+' },
};

/**
 * Previous/next buttons with a caption between them. Generic — nothing about subtunes, tracks, or
 * any other caller concept appears in it; the caption and both accessible names are entirely
 * caller-composed. When a press disables the button that has focus, focus moves to the other
 * button, so keyboard focus never drops out of the control.
 *
 * @example
 * ```html
 * <lib-stepper
 *   [text]="'Subtune ' + currentSubtune() + ' of ' + subtuneCount()"
 *   [previousDisabled]="!canStepSubtune()"
 *   [nextDisabled]="!canStepSubtune()"
 *   previousAccessibleName="Previous subtune deck A"
 *   nextAccessibleName="Next subtune deck A"
 *   (previous)="onPreviousSubtune()"
 *   (next)="onNextSubtune()"
 * />
 * ```
 */
@Component({
  selector: 'lib-stepper',
  templateUrl: './stepper.component.html',
  styleUrl: './stepper.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StepperComponent {
  private readonly injector = inject(Injector);
  private readonly previousButton = viewChild<ElementRef<HTMLButtonElement>>('previousButton');
  private readonly nextButton = viewChild<ElementRef<HTMLButtonElement>>('nextButton');

  /** The caption rendered between the two buttons, e.g. 'Subtune 1 of 3' — caller-composed. */
  readonly text = input.required<string>();
  /** Disables the previous button. Defaults to `false`. */
  readonly previousDisabled = input<boolean>(false);
  /** Disables the next button. Defaults to `false`. */
  readonly nextDisabled = input<boolean>(false);
  /** Accessible label for the previous button, e.g. 'Previous subtune deck A'. */
  readonly previousAccessibleName = input.required<string>();
  /** Accessible label for the next button, e.g. 'Next subtune deck A'. */
  readonly nextAccessibleName = input.required<string>();
  /** The glyphs on the buttons: ◀ / ▶ (`arrows`, the default) or − / + (`signs`). */
  readonly glyphs = input<StepperGlyphs>('arrows');
  /** Emits when the previous button is clicked. */
  readonly previous = output<void>();
  /** Emits when the next button is clicked. */
  readonly next = output<void>();

  protected readonly previousGlyph = computed(() => GLYPHS[this.glyphs()].previous);
  protected readonly nextGlyph = computed(() => GLYPHS[this.glyphs()].next);

  constructor() {
    effect(() => {
      const previousDisabled = this.previousDisabled();
      const nextDisabled = this.nextDisabled();
      const previous = this.previousButton()?.nativeElement;
      const next = this.nextButton()?.nativeElement;
      const active = document.activeElement;
      const target =
        previousDisabled && !nextDisabled && active === previous
          ? next
          : nextDisabled && !previousDisabled && active === next
            ? previous
            : undefined;
      if (target) {
        afterNextRender(() => target.focus(), { injector: this.injector });
      }
    });
  }
}
