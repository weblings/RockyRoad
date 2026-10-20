export async function micPermissionState(): Promise<PermissionState | null> {
    try {
        return (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state;
    } catch {
        return null;
    }
}
