// SPDX-License-Identifier: Apache-2.0

export const OPENING_OVERLAY_DELAY_MS = 200;

export class DelayedOpeningState {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly setVisible: (entryId: string | null) => void) {}

  start(entryId: string) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.setVisible(entryId);
    }, OPENING_OVERLAY_DELAY_MS);
  }

  clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.setVisible(null);
  }
}
