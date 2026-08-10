"use client";

export function LoadingScreen({ label = "Cargando el suelo…" }: { label?: string }) {
  return (
    <div className="loading-screen" role="status">
      <span className="loading-tiles" aria-hidden="true">
        <i /><i /><i /><i /><i /><i /><i /><i /><i />
      </span>
      <p>{label}</p>
    </div>
  );
}
