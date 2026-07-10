export function loadDataUrlImage(dataUrl: string, errorMessage: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error(errorMessage)), { once: true });
    image.src = dataUrl;
  });
}
