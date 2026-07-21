// SPDX-License-Identifier: Apache-2.0

export interface ProjectLibraryNotice {
  entryId: string;
  message: string;
  motion: "visible" | "closing";
}

export const projectActionNoticeVisibleMs = 2_400;
export const projectActionNoticeExitMs = 180;

export class ProjectActionNoticeState {
  private visibleTimer: ReturnType<typeof setTimeout> | null = null;
  private exitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly publish: (notice: ProjectLibraryNotice | null) => void) {}

  show(entryId: string, message: string): void {
    this.clearTimers();
    const notice = { entryId, message, motion: "visible" } as const;
    this.publish(notice);
    this.visibleTimer = setTimeout(() => {
      this.visibleTimer = null;
      this.publish({ ...notice, motion: "closing" });
      this.exitTimer = setTimeout(() => {
        this.exitTimer = null;
        this.publish(null);
      }, projectActionNoticeExitMs);
    }, projectActionNoticeVisibleMs);
  }

  clear(): void {
    this.clearTimers();
    this.publish(null);
  }

  dispose(): void {
    this.clearTimers();
  }

  private clearTimers(): void {
    if (this.visibleTimer !== null) clearTimeout(this.visibleTimer);
    if (this.exitTimer !== null) clearTimeout(this.exitTimer);
    this.visibleTimer = null;
    this.exitTimer = null;
  }
}
