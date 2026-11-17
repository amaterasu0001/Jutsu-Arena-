import { useCallback, useMemo } from 'react';

import type { SignLookup } from '@/components/SequenceTrack';
import { useApi } from '@/hooks/useApi';
import { titleCase } from '@/lib/format';
import { api } from '@/services/api';
import type { Jutsu, Sign } from '@/types/api';

/** Signs and jutsu from the server, plus a lookup for display names. */
export function useCatalog() {
  const signsState = useApi(api.signs);
  const jutsuState = useApi(api.jutsu);

  const signs: Sign[] = useMemo(() => signsState.data?.signs ?? [], [signsState.data]);
  const jutsu: Jutsu[] = useMemo(() => jutsuState.data?.jutsu ?? [], [jutsuState.data]);

  const byId = useMemo(() => new Map(signs.map((sign) => [sign.id, sign])), [signs]);
  const lookup: SignLookup = useCallback(
    (signId) => {
      const sign = byId.get(signId);
      return sign ? { name: sign.name, kanji: sign.kanji } : { name: titleCase(signId), kanji: '·' };
    },
    [byId],
  );

  const reloadSigns = signsState.reload;
  const reloadJutsu = jutsuState.reload;
  const reload = useCallback(async () => {
    await Promise.all([reloadSigns(), reloadJutsu()]);
  }, [reloadSigns, reloadJutsu]);

  return {
    signs,
    jutsu,
    signsResponse: signsState.data,
    jutsuNote: jutsuState.data?.note ?? null,
    lookup,
    loading: signsState.loading || jutsuState.loading,
    error: signsState.error ?? jutsuState.error,
    offline: signsState.offline || jutsuState.offline,
    reload,
    reloadJutsu,
    reloadSigns,
  };
}
