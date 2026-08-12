"use client";

import { Check, X } from "lucide-react";

import { soundBank } from "../audio/sfx.ts";
import { characterCatalog } from "../characters/catalog.ts";

type Props = {
  characterId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
};

/**
 * Character chooser. Deliberately low-key — it opens from a small control in
 * the header rather than sitting on the main surface.
 *
 * The Sahur credit is a CC-BY licence requirement; CC0 credits document
 * provenance and thank the creator. Keep both visible. See ATTRIBUTIONS.md.
 */
export function CharacterPicker({ characterId, onSelect, onClose }: Props) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <button
        aria-label="Cerrar selector de personaje"
        className="dialog-backdrop-dismiss"
        onClick={onClose}
        type="button"
      />
      <section
        aria-labelledby="character-dialog-title"
        aria-modal="true"
        className="dialog character-dialog"
        role="dialog"
      >
        <header className="dialog-head">
          <div>
            <span className="game-card-category">Personaje</span>
            <h2 id="character-dialog-title">Elige tu personaje</h2>
            <p>Solo cambia quién juega: las reglas de cada juego son las mismas.</p>
          </div>
          <button aria-label="Cerrar" className="dialog-close" onClick={onClose} type="button">
            <X aria-hidden="true" />
          </button>
        </header>

        <ul className="character-list" role="radiogroup" aria-label="Personajes">
          {characterCatalog.map((character) => {
            const active = character.id === characterId;
            return (
              <li key={character.id}>
                <button
                  aria-checked={active}
                  className={`character-option${active ? " is-active" : ""}`}
                  onClick={() => {
                    soundBank.ui();
                    onSelect(character.id);
                    onClose();
                  }}
                  role="radio"
                  type="button"
                >
                  <span className="character-option__title">
                    <strong>{character.label}</strong>
                    {active ? <Check aria-hidden="true" /> : null}
                  </span>
                  <span>{character.description}</span>
                </button>
                {character.credit ? (
                  <small className="character-credit">
                    Modelo de{" "}
                    <a href={character.credit.url} rel="noreferrer noopener" target="_blank">
                      {character.credit.author}
                    </a>{" "}
                    · {character.credit.license}
                  </small>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
