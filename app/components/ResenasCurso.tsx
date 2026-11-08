"use client";
// app/components/ResenasCurso.tsx — Práctica 4. Formulario + lista en vivo + resumen.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { borrarResena, escucharResenas, guardarResena, resumenDe, type Resena } from "@/lib/resenas";
import styles from "./ResenasCurso.module.css";

interface Resumen {
  cantidad: number;
  promedio: number | null;
}

export default function ResenasCurso({ cursoId, uid }: { cursoId: string; uid: string | null }) {
  const [resenas, setResenas] = useState<Resena[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [soloCinco, setSoloCinco] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Suscripción en tiempo real: el useEffect devuelve la función de cancelación, así React
  // la llama al desmontar o al cambiar de curso/filtro (sin esto quedarían suscripciones huérfanas).
  useEffect(() => {
    setError(null);
    return escucharResenas(cursoId, setResenas, (e) => setError(e.message), soloCinco);
  }, [cursoId, soloCinco]);

  // La agregación NO es en tiempo real: hay que volver a pedirla.
  const actualizarResumen = useCallback(() => {
    resumenDe(cursoId)
      .then(setResumen)
      .catch((e: Error) => setError(e.message));
  }, [cursoId]);

  // Se recalcula al abrir y cuando cambia la cantidad de reseñas (alguien publicó o borró).
  useEffect(() => {
    actualizarResumen();
  }, [actualizarResumen, resenas.length]);

  const mia = resenas.find((r) => r.uid === uid);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const texto = String(f.get("texto") ?? "").trim();
    if (!texto) {
      setError("Escribí un comentario antes de publicar.");
      return;
    }
    setGuardando(true);
    try {
      await guardarResena(cursoId, Number(f.get("puntaje")), texto);
      setError(null);
      actualizarResumen(); // cubre las ediciones, que no cambian la cantidad
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function onBorrar() {
    try {
      await borrarResena(cursoId);
      setError(null);
      actualizarResumen();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className={styles.resenas}>
      <h3>
        Reseñas
        {resumen && resumen.cantidad > 0 && ` · ★ ${resumen.promedio?.toFixed(1)} (${resumen.cantidad})`}
      </h3>

      <label>
        <input type="checkbox" checked={soloCinco} onChange={(e) => setSoloCinco(e.target.checked)} /> Solo 5 estrellas
      </label>

      {uid && (
        // `key` fuerza a rearmar el formulario cuando llega mi reseña desde el servidor,
        // así los valores por defecto (defaultValue) muestran lo que ya había publicado.
        <form key={mia ? "editar" : "nueva"} onSubmit={onSubmit} className={styles.formulario}>
          <select name="puntaje" defaultValue={mia?.puntaje ?? 5} aria-label="Puntaje">
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {"★".repeat(n)}
              </option>
            ))}
          </select>
          <textarea
            name="texto"
            maxLength={500}
            defaultValue={mia?.texto ?? ""}
            placeholder="Contá tu experiencia con el curso"
            aria-label="Comentario"
            required
          />
          <div className={styles.botones}>
            <button type="submit" className="button button--small" disabled={guardando}>
              {guardando ? "Guardando…" : mia ? "Actualizar mi reseña" : "Publicar"}
            </button>
            {mia && (
              <button type="button" className="button button--small button--ghost" onClick={onBorrar}>
                Borrar mi reseña
              </button>
            )}
          </div>
        </form>
      )}
      {!uid && <small className="hint">Ingresá para dejar tu reseña.</small>}

      {error && (
        <p className="alerta alerta--error" role="alert">
          {error}
        </p>
      )}

      <ul className={styles.lista}>
        {resenas.map((r) => (
          <li key={r.uid}>
            <strong>{"★".repeat(r.puntaje)}</strong> {r.texto} — <em>{r.autor}</em>
            {r.creadaEn && <small> · {r.creadaEn.toDate().toLocaleDateString("es-AR")}</small>}
            {r.pendiente && <small className={styles.pendiente}> · guardando…</small>}
          </li>
        ))}
      </ul>
    </section>
  );
}
