// tests/reglas.test.mjs — Práctica 4. Se ejecuta contra el emulador de Firestore:
//   npm run test:reglas
import { after, before, beforeEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from "firebase/firestore";

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment} */
let env;
const CURSO = "seguridad-web";
const resena = (extra = {}) => ({ puntaje: 5, texto: "Muy bueno", autor: "Ana", creadaEn: serverTimestamp(), ...extra });

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-resenas",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
beforeEach(() => env.clearFirestore());
after(() => env.cleanup());

/** Deja una reseña ya creada (saltándose las reglas) para probar edición y borrado. */
async function sembrar(uid) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "cursos", CURSO, "resenas", uid), resena({ autor: uid }));
  });
}

// ── Los 8 casos de la consigna ──────────────────────────────────────────────

test("cualquiera puede leer reseñas, incluso sin login", async () => {
  const anon = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(anon, "cursos", CURSO, "resenas", "ana")));
});

test("Ana puede crear SU reseña", async () => {
  const db = env.authenticatedContext("ana").firestore();
  await assertSucceeds(setDoc(doc(db, "cursos", CURSO, "resenas", "ana"), resena()));
});

test("Ana NO puede crear una reseña a nombre de Bruno", async () => {
  const db = env.authenticatedContext("ana").firestore();
  await assertFails(setDoc(doc(db, "cursos", CURSO, "resenas", "bruno"), resena()));
});

test("sin login no se puede escribir", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, "cursos", CURSO, "resenas", "ana"), resena()));
});

test("puntaje fuera de rango o con decimales se rechaza", async () => {
  const db = env.authenticatedContext("ana").firestore();
  const ref = doc(db, "cursos", CURSO, "resenas", "ana");
  await assertFails(setDoc(ref, resena({ puntaje: 6 })));
  await assertFails(setDoc(ref, resena({ puntaje: 4.5 })));
});

test("no se pueden agregar campos extra (p. ej. destacada: true)", async () => {
  const db = env.authenticatedContext("ana").firestore();
  await assertFails(setDoc(doc(db, "cursos", CURSO, "resenas", "ana"), resena({ destacada: true })));
});

test("la fecha de creación la pone el servidor y no se puede cambiar", async () => {
  const db = env.authenticatedContext("ana").firestore();
  const ref = doc(db, "cursos", CURSO, "resenas", "ana");
  await assertFails(setDoc(ref, resena({ creadaEn: Timestamp.fromDate(new Date(2020, 0, 1)) })));
  await assertSucceeds(setDoc(ref, resena()));
  await assertFails(updateDoc(ref, { creadaEn: Timestamp.now() }));
  await assertSucceeds(updateDoc(ref, { puntaje: 4 }));
});

test("el cliente no puede escribir el documento del curso", async () => {
  const db = env.authenticatedContext("ana").firestore();
  await assertFails(setDoc(doc(db, "cursos", CURSO), { resumen: { cantidad: 999, promedio: 5 } }));
});

// ── Tests adicionales propios ───────────────────────────────────────────────

test("Bruno NO puede editar ni borrar la reseña de Ana", async () => {
  await sembrar("ana");
  const db = env.authenticatedContext("bruno").firestore();
  const ref = doc(db, "cursos", CURSO, "resenas", "ana");
  await assertFails(updateDoc(ref, { puntaje: 1 }));
  await assertFails(deleteDoc(ref));
});

test("Ana puede editar (conservando la fecha) y borrar SU reseña", async () => {
  await sembrar("ana");
  const db = env.authenticatedContext("ana").firestore();
  const ref = doc(db, "cursos", CURSO, "resenas", "ana");
  await assertSucceeds(setDoc(ref, { puntaje: 3, texto: "Cambié de opinión", autor: "Ana" }, { merge: true }));
  await assertSucceeds(deleteDoc(ref));
});

test("sin login no se puede borrar una reseña", async () => {
  await sembrar("ana");
  const db = env.unauthenticatedContext().firestore();
  await assertFails(deleteDoc(doc(db, "cursos", CURSO, "resenas", "ana")));
});

test("texto vacío o de más de 500 caracteres se rechaza", async () => {
  const db = env.authenticatedContext("ana").firestore();
  const ref = doc(db, "cursos", CURSO, "resenas", "ana");
  await assertFails(setDoc(ref, resena({ texto: "" })));
  await assertFails(setDoc(ref, resena({ texto: "x".repeat(501) })));
  await assertSucceeds(setDoc(ref, resena({ texto: "x".repeat(500) })));
});

test("autor vacío o de más de 80 caracteres se rechaza", async () => {
  const db = env.authenticatedContext("ana").firestore();
  const ref = doc(db, "cursos", CURSO, "resenas", "ana");
  await assertFails(setDoc(ref, resena({ autor: "" })));
  await assertFails(setDoc(ref, resena({ autor: "a".repeat(81) })));
});

test("los tipos incorrectos se rechazan (puntaje como texto, texto como número)", async () => {
  const db = env.authenticatedContext("ana").firestore();
  const ref = doc(db, "cursos", CURSO, "resenas", "ana");
  await assertFails(setDoc(ref, resena({ puntaje: "5" })));
  await assertFails(setDoc(ref, resena({ texto: 123 })));
});

test("lo que no está habilitado queda cerrado (otras colecciones)", async () => {
  const db = env.authenticatedContext("ana").firestore();
  await assertFails(setDoc(doc(db, "otra-coleccion", "x"), { a: 1 }));
  await assertFails(getDoc(doc(db, "otra-coleccion", "x")));
});
