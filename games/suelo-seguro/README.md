# Suelo Seguro

Juego cooperativo para entre uno y ocho jugadores. Cada participante ocupa una
plataforma propia de 2×2 para iniciar. Durante la partida las plataformas se
turnan: la del jugador activo desaparece y aparece un nuevo refugio de su mismo
color en otra zona del suelo.

El jugador activo debe llegar al nuevo refugio antes de que termine su turno.
Un patrón diagonal rojo se desplaza continuamente entre las plataformas;
pisarlo o dejar pasar el turno consume una vida compartida. El equipo gana al
completar dos vueltas de relevos, con un mínimo de seis traslados.

El número configurado de jugadores determina las zonas de inicio, el orden de
turnos, la puntuación individual y el objetivo de la partida. Por eso el juego
no admite `0 / Cualquiera`; se prueban expresamente todos los tamaños de uno a
ocho jugadores.

```sh
npm run test --workspace @motion-levels-games/suelo-seguro
npm run typecheck --workspace @motion-levels-games/suelo-seguro
```
