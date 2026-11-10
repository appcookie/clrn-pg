import type { Bounds } from './native-device';
import { observePreparedPress } from './prepared-press-diagnostics';

/** Observe the existing single tap without adding queries during animation. */
export function observeRenewExitPress(game: string, name: string, phase: string,
  bounds: Bounds, screen: { width: number; height: number }, press: () => Promise<void>,
  write: (body: string) => void = body => console.log('[zhajinhua renew exit input]', body)): () => Promise<void> {
  if (game !== 'zhajinhua' || name !== 'renew' || phase !== 'exit') return press;
  return observePreparedPress('zhajinhua renew exit', bounds, screen, press, body => {
    const { preparedCenter: point, ...evidence } = JSON.parse(body);
    write(JSON.stringify({ ...evidence, point }));
  });
}
