"use client";

// lib/resenas.ts — Práctica 4 (Firestore). Capa de acceso a datos de reseñas.
// Los componentes NO importan "firebase/firestore" directamente: todo pasa por acá.
import {
  average,
  collection,
  connectFirestoreEmulator,
  count,
  deleteDoc,
  doc,
  getAggregateFromServer,
  getDoc,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
  type Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { USA_EMULADORES, firebase } from "./firebase";

export interface Resena {
  uid: string; // id del documento (= UID del autor)
  puntaje: number; // 1..5
  texto: string;
  autor: string;
  creadaEn: Timestamp | null; // null mientras el serverTimestamp está pendiente (escritura local)
  pendiente: boolean; // true mientras el servidor todavía no confirmó la escritura
}

// ── Paso 1 · Inicialización ────────────────────────────────────────────────
let db: Firestore | null = null;

/** Firestore del proyecto. En `npm run dev` se conecta al emulador (127.0.0.1:8080). */
export function firestore(): Firestore {
  if (db) return db;
  // Reutilizamos la app que ya inicializa lib/firebase.ts (la misma que usa Auth).
  const instancia = getFirestore(firebase().app);
  if (USA_EMULADORES) {
    try {
      connectFirestoreEmulator(instancia, "127.0.0.1", 8080);
    } catch {
      // Con el hot-reload de `next dev` este módulo se vuelve a evaluar y el emulador
      // ya estaba conectado: Firestore lanza un error que podemos ignorar.
    }
  }
  db = instancia;
  return db;
}

/** cursos/{cursoId}/resenas */
const resenasDe = (cursoId: string) => collection(firestore(), "cursos", cursoId, "resenas");

// ── Paso 3 · Escribir la reseña ────────────────────────────────────────────
/**
 * Crear o editar MI reseña. El id del documento es mi UID: una reseña por persona y curso.
 * - Si no existía: se manda `creadaEn: serverTimestamp()` (las reglas exigen que lo ponga el servidor).
 * - Si ya existía: `merge: true` SIN `creadaEn`, para conservar la fecha original
 *   (las reglas exigen que no cambie).
 */
export async function guardarResena(cursoId: string, puntaje: number, texto: string): Promise<void> {
  const usuario = firebase().auth.currentUser;
  if (!usuario) throw new Error("Tenés que ingresar para dejar una reseña.");
  if (!Number.isInteger(puntaje) || puntaje < 1 || puntaje > 5) {
    throw new Error("El puntaje tiene que ser un número entero entre 1 y 5.");
  }

  const ref = doc(resenasDe(cursoId), usuario.uid);
  const datos = { puntaje, texto, autor: (usuario.displayName || "Anónimo").slice(0, 80) };

  // Se consulta el documento en vez de confiar en lo que muestra la lista: la lista está
  // limitada a 20 y puede estar filtrada, así que "mi reseña" podría existir y no verse.
  // Tratarla como nueva intentaría pisar `creadaEn` y las reglas lo rechazarían.
  const existente = await getDoc(ref);
  if (existente.exists()) await setDoc(ref, datos, { merge: true });
  else await setDoc(ref, { ...datos, creadaEn: serverTimestamp() });
}

export async function borrarResena(cursoId: string): Promise<void> {
  const usuario = firebase().auth.currentUser;
  if (!usuario) return;
  await deleteDoc(doc(resenasDe(cursoId), usuario.uid));
}

// ── Paso 4 · Escuchar en tiempo real ───────────────────────────────────────
/** Últimas reseñas del curso (máx. 20). Devuelve la función para cancelar la suscripción. */
export function escucharResenas(
  cursoId: string,
  alCambiar: (resenas: Resena[]) => void,
  alFallar: (e: Error) => void,
  soloCincoEstrellas = false,
): Unsubscribe {
  // El filtro de igualdad + orderBy sobre OTRO campo exige el índice compuesto (Paso 8).
  const filtros = soloCincoEstrellas ? [where("puntaje", "==", 5)] : [];
  const q = query(resenasDe(cursoId), ...filtros, orderBy("creadaEn", "desc"), limit(20));
  return onSnapshot(
    q,
    // includeMetadataChanges: también avisa cuando el servidor CONFIRMA una escritura
    // (hasPendingWrites pasa de true a false), así el "guardando…" se apaga solo.
    // Esos avisos son solo de metadatos: no cuestan lecturas.
    { includeMetadataChanges: true },
    (snap) =>
      alCambiar(
        snap.docs.map((d) => {
          // "estimate": mientras la escritura local está pendiente, creadaEn todavía no tiene
          // el valor del servidor; con "estimate" el SDK usa una estimación en lugar de null.
          const data = d.data({ serverTimestamps: "estimate" });
          return {
            uid: d.id,
            puntaje: data.puntaje,
            texto: data.texto,
            autor: data.autor,
            creadaEn: data.creadaEn ?? null,
            pendiente: d.metadata.hasPendingWrites,
          };
        }),
      ),
    alFallar,
  );
}

// ── Paso 5 · Resumen con consulta de agregación ────────────────────────────
/** Promedio y cantidad calculados por el servidor (no es en tiempo real: no admite listeners). */
export async function resumenDe(cursoId: string): Promise<{ cantidad: number; promedio: number | null }> {
  const snap = await getAggregateFromServer(resenasDe(cursoId), {
    cantidad: count(),
    promedio: average("puntaje"),
  });
  return snap.data();
}
