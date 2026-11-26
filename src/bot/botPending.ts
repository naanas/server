export type PendingMenuAction = 'task' | 'link' | 'delete';

const pendingIssueKey = new Map<number, PendingMenuAction>();

export const clearPendingIssueKey = (chatId: number) => pendingIssueKey.delete(chatId);

export const getPendingIssueKey = (chatId: number) => pendingIssueKey.get(chatId);

export const setPendingIssueKey = (chatId: number, action: PendingMenuAction) =>
    pendingIssueKey.set(chatId, action);

export const takePendingIssueKey = (chatId: number) => {
    const action = pendingIssueKey.get(chatId);
    pendingIssueKey.delete(chatId);
    return action;
};
