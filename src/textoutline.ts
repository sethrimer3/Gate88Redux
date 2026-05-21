let installed = false;

export function installTextOutline(): void {
  if (installed) return;
  installed = true;
  const proto = CanvasRenderingContext2D.prototype;
  const originalFillText = proto.fillText;
  proto.fillText = function outlinedFillText(
    text: string,
    x: number,
    y: number,
    maxWidth?: number,
  ): void {
    this.save();
    const fill = this.fillStyle;
    const composite = this.globalCompositeOperation;
    const shadowColor = this.shadowColor;
    const shadowBlur = this.shadowBlur;
    const shadowOffsetX = this.shadowOffsetX;
    const shadowOffsetY = this.shadowOffsetY;
    this.globalCompositeOperation = 'source-over';
    this.shadowColor = 'rgba(0,0,0,0.95)';
    this.shadowBlur = 7;
    this.shadowOffsetX = 0;
    this.shadowOffsetY = 0;
    this.fillStyle = fill;
    if (maxWidth === undefined) {
      originalFillText.call(this, text, x, y);
    } else {
      originalFillText.call(this, text, x, y, maxWidth);
    }
    this.fillStyle = fill;
    this.globalCompositeOperation = composite;
    this.shadowColor = shadowColor;
    this.shadowBlur = shadowBlur;
    this.shadowOffsetX = shadowOffsetX;
    this.shadowOffsetY = shadowOffsetY;
    this.restore();
  };
}
