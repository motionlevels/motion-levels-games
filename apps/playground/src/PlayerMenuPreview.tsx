/* oxlint-disable react/iframe-missing-sandbox */

type PlayerMenuPreviewProps = Readonly<{
  active?: boolean;
  src: string;
}>;

export function PlayerMenuPreview({ active = true, src }: PlayerMenuPreviewProps) {
  return (
    <div
      aria-hidden={!active}
      className={`display-preview-native player-menu-preview-native ${active ? "is-active" : "is-background"}`}
      data-active={active}
    >
      {/* The menu has its own document and styles, but is served by the same
          Vite process as the playground. */}
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
