/**
 * Reads the GitHub owner and repository from the `app-update.yml` file that electron-builder writes next to the
 * application (generated from the `publish` section). Only plain `key: value` lines are needed.
 */
export function parseFeedRepo(yaml: string): { owner: string; repo: string } | null {
    const value = (key: string): string | null => {
        const match = new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, 'm').exec(yaml)
        const raw = match?.[1]?.replace(/^["']|["']$/g, '').trim()
        return raw && /^[A-Za-z0-9._-]+$/.test(raw) ? raw : null
    }
    if (value('provider') !== 'github') return null
    const owner = value('owner')
    const repo = value('repo')
    return owner && repo ? { owner, repo } : null
}

export function releasePageUrl(repo: { owner: string; repo: string }, version: string): string {
    return `https://github.com/${repo.owner}/${repo.repo}/releases/tag/v${encodeURIComponent(version)}`
}
