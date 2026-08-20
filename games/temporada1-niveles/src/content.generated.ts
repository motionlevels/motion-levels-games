import { createRepositoryAuthoredLevelContent } from "@motion-levels-games/published-level-runtime/source";
import type { AuthoredGameSourceManifest } from "@motion-levels-games/published-level-runtime";
import gameSource from "../content/game.json" with { type: "json" };
import level0 from "../content/levels/0269da5e-bb97-4306-8ace-8e5c303ab153.json" with { type: "json" };
import level1 from "../content/levels/05b243c6-d345-4b3b-8455-9ca05efa670b.json" with { type: "json" };
import level2 from "../content/levels/06889ac2-ce94-4e2b-8d39-3ec686adc462.json" with { type: "json" };
import level3 from "../content/levels/0955f4c9-213b-4bff-85b6-19d804fd2c32.json" with { type: "json" };
import level4 from "../content/levels/0a6b9a3c-85cc-4ba1-8aa8-41d160e24288.json" with { type: "json" };
import level5 from "../content/levels/0f5c0a95-08cb-4a49-85aa-8deece3f7d04.json" with { type: "json" };
import level6 from "../content/levels/0fdccd8a-9f11-4bb7-8472-fc545d653aca.json" with { type: "json" };
import level7 from "../content/levels/101be5b8-c3c8-4c59-86ae-20cbaec825ce.json" with { type: "json" };
import level8 from "../content/levels/10cb5c6f-f3c5-4f93-8c72-6e20a97d4d57.json" with { type: "json" };
import level9 from "../content/levels/11ab59b5-b6b3-4ec8-8665-6d1e3d61678d.json" with { type: "json" };
import level10 from "../content/levels/11fd33be-b262-4fa4-8ad5-def69cfaaa81.json" with { type: "json" };
import level11 from "../content/levels/1379de16-180e-4b6b-85cc-7a34f137da50.json" with { type: "json" };
import level12 from "../content/levels/1839b4b5-860d-4608-8455-3c95d1eb2c6f.json" with { type: "json" };
import level13 from "../content/levels/188ddde0-9534-4f72-8dc7-ca21cd068d3a.json" with { type: "json" };
import level14 from "../content/levels/1aed707a-cf5d-43d7-884d-31800a0ccc40.json" with { type: "json" };
import level15 from "../content/levels/1bffb13c-ed36-470d-8d3d-a2e94c5ffd3a.json" with { type: "json" };
import level16 from "../content/levels/1cfbf644-d82e-4d30-8c63-c8326d8eb81b.json" with { type: "json" };
import level17 from "../content/levels/1d1514be-50da-45f9-8b0b-a90cd3bb49fa.json" with { type: "json" };
import level18 from "../content/levels/1d3ede55-085a-4b09-8b9f-30401a7e5600.json" with { type: "json" };
import level19 from "../content/levels/1e01a0b2-ba12-4e21-8ca9-2bc15dca93bf.json" with { type: "json" };
import level20 from "../content/levels/23a2441d-6261-434d-8d63-3e017c94d724.json" with { type: "json" };
import level21 from "../content/levels/2715dc6f-35ea-458d-8a02-33f2c6442f33.json" with { type: "json" };
import level22 from "../content/levels/2fc2e0e5-c06f-4697-8884-41d0de440b25.json" with { type: "json" };
import level23 from "../content/levels/310a2050-f806-4622-8b01-6e4a7a7a8ff0.json" with { type: "json" };
import level24 from "../content/levels/37524882-c45b-4957-843a-cda643c03c84.json" with { type: "json" };
import level25 from "../content/levels/3ac1c128-640c-49e3-8e10-b806911cd198.json" with { type: "json" };
import level26 from "../content/levels/3cbb5e16-5b13-4ebb-8054-5277154f41fa.json" with { type: "json" };
import level27 from "../content/levels/3ceed4a0-6c70-48ca-878b-a1f680bdcfdc.json" with { type: "json" };
import level28 from "../content/levels/3e379e70-a056-45eb-8fc0-ebf1054460da.json" with { type: "json" };
import level29 from "../content/levels/3fe0de9e-739b-4ded-82af-008466ef1488.json" with { type: "json" };
import level30 from "../content/levels/40b6f4d6-eb77-4ae9-85c3-7c1f008d024b.json" with { type: "json" };
import level31 from "../content/levels/4110ca20-14c4-4d75-8c71-2c2c6bb33cb2.json" with { type: "json" };
import level32 from "../content/levels/4401de3f-b789-41cf-8186-de76787bccb3.json" with { type: "json" };
import level33 from "../content/levels/4708474a-9abe-4a4c-80aa-9e7d69b2175a.json" with { type: "json" };
import level34 from "../content/levels/5300a9e8-23d0-4af7-8337-531ec3c4cab1.json" with { type: "json" };
import level35 from "../content/levels/5686148f-d598-44b8-8815-63feeb296efb.json" with { type: "json" };
import level36 from "../content/levels/5bd8bb81-c9ae-4f09-8629-1b6d85e7bdd1.json" with { type: "json" };
import level37 from "../content/levels/5cfde2e5-aa16-4a79-87bb-00a3e71466a7.json" with { type: "json" };
import level38 from "../content/levels/60b76a71-5ab2-49e9-88b9-bfeddd416e50.json" with { type: "json" };
import level39 from "../content/levels/6ad0c7cb-695c-47fb-896f-6220fcc2bd49.json" with { type: "json" };
import level40 from "../content/levels/6ad1b3e2-aea4-47e5-85b0-11f2b6a38b41.json" with { type: "json" };
import level41 from "../content/levels/6c9e9a05-cd78-453d-8221-d5769d833cea.json" with { type: "json" };
import level42 from "../content/levels/6cf64acc-b2eb-48cb-8780-55392f52ea68.json" with { type: "json" };
import level43 from "../content/levels/70158e74-1e28-4060-819d-6f8cf028019a.json" with { type: "json" };
import level44 from "../content/levels/70eccd64-3fef-48cf-8495-fa93f9b5fdb5.json" with { type: "json" };
import level45 from "../content/levels/7184c387-6449-458b-80e4-d9caa3a1c279.json" with { type: "json" };
import level46 from "../content/levels/750e519d-087a-4dbd-8b68-14441cd16ef8.json" with { type: "json" };
import level47 from "../content/levels/7670926b-8055-4936-817e-234a121035f2.json" with { type: "json" };
import level48 from "../content/levels/7811e991-c417-4df0-8907-ff052249c8a2.json" with { type: "json" };
import level49 from "../content/levels/78b70a34-3996-450d-8de7-51fb095e9618.json" with { type: "json" };
import level50 from "../content/levels/79db9d3e-9af5-4b35-807b-10bee99442d1.json" with { type: "json" };
import level51 from "../content/levels/7b037fee-1ca7-498b-860f-4044d14e4b2b.json" with { type: "json" };
import level52 from "../content/levels/7dc40133-306c-4618-88b9-cf059bb36949.json" with { type: "json" };
import level53 from "../content/levels/7ea94f35-7012-42b1-85b6-40cf180993ee.json" with { type: "json" };
import level54 from "../content/levels/814e7bdc-e140-4b25-8b04-6532c9c66ea3.json" with { type: "json" };
import level55 from "../content/levels/82359aad-d855-492b-8231-b9c209d7d3d9.json" with { type: "json" };
import level56 from "../content/levels/82dc857d-2842-4461-874e-331883207174.json" with { type: "json" };
import level57 from "../content/levels/83b1e03a-29c4-4928-84fa-9c87bab6ae1e.json" with { type: "json" };
import level58 from "../content/levels/85db8823-9e66-4745-8df8-36340908ddcd.json" with { type: "json" };
import level59 from "../content/levels/88a2aa7c-355b-4307-8efb-0e0ed5162a4c.json" with { type: "json" };
import level60 from "../content/levels/8f4a18fc-4e5b-48ca-897c-b18e2be8ff98.json" with { type: "json" };
import level61 from "../content/levels/90b49c7a-d789-45df-8a31-434379b881d5.json" with { type: "json" };
import level62 from "../content/levels/934b8090-5343-4630-83fa-44fc8cddfd99.json" with { type: "json" };
import level63 from "../content/levels/95859f8c-1039-4a34-8cc7-2142d343d6f4.json" with { type: "json" };
import level64 from "../content/levels/988c8bd2-20ac-4822-840d-f815147c11fb.json" with { type: "json" };
import level65 from "../content/levels/98e03147-6926-4ae2-81c4-b8e86b7e92b5.json" with { type: "json" };
import level66 from "../content/levels/9b4bcf9b-fcd3-42ff-81ba-be2a78e266a6.json" with { type: "json" };
import level67 from "../content/levels/a0e3e13c-4fd2-424e-8646-cec5e0c2db29.json" with { type: "json" };
import level68 from "../content/levels/a308d6d7-9232-4e50-8b0c-6d1858fa0e87.json" with { type: "json" };
import level69 from "../content/levels/a309b618-ab9d-43f4-84f7-1bb55d817708.json" with { type: "json" };
import level70 from "../content/levels/a4853036-139b-4813-8e74-cc70f1d800ba.json" with { type: "json" };
import level71 from "../content/levels/a944dc5b-33c0-4b11-8201-e54e449a77c2.json" with { type: "json" };
import level72 from "../content/levels/ad79d0ed-008d-497c-8c40-e58b618c0d39.json" with { type: "json" };
import level73 from "../content/levels/af267efe-3867-4e71-894c-68742f982323.json" with { type: "json" };
import level74 from "../content/levels/b168921f-ee0f-49b0-80d5-9de9dbc580a5.json" with { type: "json" };
import level75 from "../content/levels/b38c1b5e-5cb8-4efd-80df-8d6a69e72867.json" with { type: "json" };
import level76 from "../content/levels/b73251ca-68dc-4a02-84bd-c8d1fc66426c.json" with { type: "json" };
import level77 from "../content/levels/c5217a4b-199d-4de9-8f6e-57701b82bbc6.json" with { type: "json" };
import level78 from "../content/levels/c8188b59-57d2-4008-8983-3ede6ae24340.json" with { type: "json" };
import level79 from "../content/levels/cabb7dcb-0bdc-474e-86f3-799d42b3cf89.json" with { type: "json" };
import level80 from "../content/levels/cb4ff5ff-0a5f-4785-8df5-12f54b9d6085.json" with { type: "json" };
import level81 from "../content/levels/cc32d3c7-ff91-4c99-8555-735d19fc3b4f.json" with { type: "json" };
import level82 from "../content/levels/d659f5d8-35bf-490f-849b-05409a3127a4.json" with { type: "json" };
import level83 from "../content/levels/d96eddd3-26ac-4396-8a86-6f08c1305f77.json" with { type: "json" };
import level84 from "../content/levels/dab26bea-9e7b-4d2f-8da2-43f033b223ac.json" with { type: "json" };
import level85 from "../content/levels/dbbbccf4-97b7-4f19-8fd7-c4606ffccbfd.json" with { type: "json" };
import level86 from "../content/levels/dc28785a-6b65-4519-86c2-d13c2c04ac21.json" with { type: "json" };
import level87 from "../content/levels/e10a2f04-b151-4402-861b-f38bf37536fe.json" with { type: "json" };
import level88 from "../content/levels/e1fcef96-ebaa-4c8f-80ae-16b468299dde.json" with { type: "json" };
import level89 from "../content/levels/e2dcf737-c1ca-4317-8bcd-06eaa39fb24e.json" with { type: "json" };
import level90 from "../content/levels/e7973b3f-277c-4265-819c-82b72c6e66e6.json" with { type: "json" };
import level91 from "../content/levels/e9d26f84-52d8-48e3-89af-5dc5482b6a2a.json" with { type: "json" };
import level92 from "../content/levels/f4a1bb0f-6aa2-4e3c-8b19-cea498395ac0.json" with { type: "json" };
import level93 from "../content/levels/f56b8ebf-dcbb-4c09-8922-2b423776efc2.json" with { type: "json" };
import level94 from "../content/levels/f988a20f-3ed9-4329-89d2-fe5cccc97ff8.json" with { type: "json" };
import level95 from "../content/levels/fddeb3e4-0d4c-483d-8931-4f4bf2009f13.json" with { type: "json" };
import resultAnimation0 from "../content/result-animations/d8db3406-f815-4a69-840d-1cea1a43facc.json" with { type: "json" };
import resultAnimation1 from "../content/result-animations/f72daac4-27a5-4144-b143-a6a85a34c3ec.json" with { type: "json" };

// Generated by npm run content:build. Edit content/*.json, not this file.
export const fallbackContent = createRepositoryAuthoredLevelContent({
  game: gameSource as AuthoredGameSourceManifest,
  levels: [level0, level1, level2, level3, level4, level5, level6, level7, level8, level9, level10, level11, level12, level13, level14, level15, level16, level17, level18, level19, level20, level21, level22, level23, level24, level25, level26, level27, level28, level29, level30, level31, level32, level33, level34, level35, level36, level37, level38, level39, level40, level41, level42, level43, level44, level45, level46, level47, level48, level49, level50, level51, level52, level53, level54, level55, level56, level57, level58, level59, level60, level61, level62, level63, level64, level65, level66, level67, level68, level69, level70, level71, level72, level73, level74, level75, level76, level77, level78, level79, level80, level81, level82, level83, level84, level85, level86, level87, level88, level89, level90, level91, level92, level93, level94, level95],
  resultAnimations: [resultAnimation0, resultAnimation1],
  contentRevision: "34e2c5513b5c72afdbd3a3a73788ab3f357cccabbc20f45a7c9f1f8cfc690361"
});

export const authoredContentSource = Object.freeze({
  game: "temporada1-niveles",
  gameId: "4773837e-3565-49d7-8953-3b40f59fca7b",
  contentRevision: fallbackContent.contentRevision
});
