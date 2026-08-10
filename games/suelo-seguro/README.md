# Suelo Seguro

Juego cooperativo para entre uno y ocho jugadores. Cada participante ocupa un
refugio propio de 2×2 en el borde de la pista. Los refugios nunca se tocan ni
quedan adyacentes. Durante la partida se turnan: el del jugador activo
desaparece y aparece otro de su mismo color en un punto separado del perímetro.

El jugador activo debe llegar al nuevo refugio antes de que termine su turno.
El tiempo empleado se suma al marcador del equipo: cuanto menor sea, mejor.
Un bloque rojo de 8×8 recorre una órbita alrededor de la pista; pisarlo o dejar
pasar el turno consume una vida compartida. El equipo gana al completar dos
vueltas de relevos, con un mínimo de seis traslados.

El número configurado de jugadores determina las zonas de inicio, el orden de
turnos, el reparto del tiempo y el objetivo de la partida. Por eso el juego
no admite `0 / Cualquiera`; se prueban expresamente todos los tamaños de uno a
ocho jugadores.

```sh
npm run test --workspace @motion-levels-games/suelo-seguro
npm run typecheck --workspace @motion-levels-games/suelo-seguro
```
