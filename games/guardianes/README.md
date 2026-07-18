# Guardianes

Juego cooperativo de defensa en cuatro carriles. Las amenazas descienden hacia
el núcleo y el grupo activa el escudo azul, rosa, amarillo o verde ocupando la
zona correspondiente en la parte inferior del suelo. Un escudo activo en el
momento del impacto bloquea la amenaza; un carril sin protección consume una
de las cuatro vidas compartidas.

La oleada de dieciséis amenazas es determinista. La dificultad modifica el
tiempo de viaje y el intervalo entre apariciones. Bloquear la oleada completa
activa una celebración final de cinco segundos; perder todas las vidas muestra
una animación de derrota distinta.

El tablero no depende del tamaño de la reserva, por lo que se admiten
`0 / Cualquiera` y de uno a ocho jugadores. Una presencia real en el núcleo
central sigue siendo obligatoria para iniciar.

```sh
npm run test --workspace @motion-levels-games/guardianes
npm run typecheck --workspace @motion-levels-games/guardianes
```
