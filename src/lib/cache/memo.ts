/**
 * Memoria para una carga de pantalla: cada clave se pide una sola vez y quien llegue después
 * (aunque sea a la vez) recibe la misma promesa. Si falla, se olvida para poder reintentar.
 */
export function memoOnce() {
  const memo = new Map<string, Promise<unknown>>();
  return <T,>(key: string, f: () => Promise<T>): Promise<T> => {
    let p = memo.get(key) as Promise<T> | undefined;
    if (!p) {
      p = f();
      memo.set(key, p);
      p.catch(() => memo.delete(key));
    }
    return p;
  };
}
