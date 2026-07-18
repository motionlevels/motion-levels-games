# Equilibrio

Juego cooperativo de coordinación sobre dos lados del suelo. Dos jugadores
ocupan las zonas centrales para iniciar y después buscan un par de plataformas
azul y rosa. Mantener ambas ocupadas a la vez completa el nivel; pisar fuera
de las plataformas reduce la estabilidad compartida.

La partida contiene cinco disposiciones deterministas. Cada nivel tiene una
celebración breve y el quinto activa una celebración final distinta. La
dificultad modifica el tiempo de ocupación y la penalización de estabilidad.

El tablero y las reglas no cambian con el tamaño de la reserva, por lo que se
admiten `0 / Cualquiera` y de dos a ocho jugadores. La detección física sigue
requiriendo dos zonas reales y el playground permite activarlas con clics
secuenciales gracias al modelo de ocupación retenida.

```sh
npm run test --workspace @motion-levels-games/equilibrio
npm run typecheck --workspace @motion-levels-games/equilibrio
```
