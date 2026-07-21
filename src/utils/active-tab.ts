/**
 * Resolve the tab a tool should act on. Without a windowId this is the active
 * tab of the caller's window (historic behavior). With a windowId — set on
 * tool instances for pinned inbound turns — it is the active tab of that
 * specific window, so a headless turn keeps working while the user browses
 * elsewhere.
 */
export async function queryActiveTab(windowId?: number): Promise<chrome.tabs.Tab | undefined> {
	const [tab] = await chrome.tabs.query(
		windowId === undefined ? { active: true, currentWindow: true } : { active: true, windowId },
	);
	return tab;
}
