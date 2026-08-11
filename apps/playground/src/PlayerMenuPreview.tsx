/* oxlint-disable react/iframe-missing-sandbox */

type PlayerMenuPreviewProps = Readonly<{
  src: string;
}>;

export function PlayerMenuPreview({ src }: PlayerMenuPreviewProps) {
  return (
    <div className="display-preview-native player-menu-preview-native">
      {/* The loopback-only Vite app needs its own origin for module loading and
          storage; its different port still isolates it from the playground. */}
      <iframe
        className="player-menu-preview-frame"
        loading="eager"
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-forms allow-modals allow-same-origin allow-scripts allow-top-navigation-by-user-activation"
        src={src}
        title="Player menu"
      />
    </div>
  );
}

/* oxlint-enable react/iframe-missing-sandbox */
