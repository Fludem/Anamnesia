import type { Lifecycle } from '../env.ts';

export class FakeLifecycle implements Lifecycle {
  private hidden = new Set<() => void>();
  private pageHide = new Set<() => void>();
  private pageShow = new Set<(persisted: boolean) => void>();
  hiddenState = false;

  onHidden(cb: () => void): () => void {
    this.hidden.add(cb);
    return () => this.hidden.delete(cb);
  }
  onPageHide(cb: () => void): () => void {
    this.pageHide.add(cb);
    return () => this.pageHide.delete(cb);
  }
  onPageShow(cb: (persisted: boolean) => void): () => void {
    this.pageShow.add(cb);
    return () => this.pageShow.delete(cb);
  }
  isHidden(): boolean {
    return this.hiddenState;
  }

  fireHidden(): void {
    this.hiddenState = true;
    for (const cb of this.hidden) cb();
  }
  fireVisible(): void {
    this.hiddenState = false;
  }
  firePageHide(): void {
    for (const cb of this.pageHide) cb();
  }
  firePageShow(persisted: boolean): void {
    for (const cb of this.pageShow) cb(persisted);
  }
}
