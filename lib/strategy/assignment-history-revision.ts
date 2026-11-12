import { randomUUID } from 'node:crypto'
import { unstable_cache, revalidateTag } from 'next/cache'

const TAG = 'strategy-assignment-history'

// Only the revision token goes in Next's shared Data Cache. The much larger
// derived estimator stays in a small worker cache.
export const getAssignmentHistoryRevision = unstable_cache(
  async () => randomUUID(), ['strategy-assignment-history-revision-v1'], { tags: [TAG] },
)

export function invalidateAssignmentHistory() {
  revalidateTag(TAG, { expire: 0 })
}
