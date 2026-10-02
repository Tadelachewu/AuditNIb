/**
 * Notification catalog - every user-facing notification message in one
 * place, each with a stable code (for consistency, de-duplication and
 * tests). Components pick an entry from here; they never write their own
 * notification text. See docs/notifications-ui.md.
 *
 * Wording standard
 *   success:  "[Object] [past-tense action] successfully."   e.g. "Branch deleted successfully."
 *   failure:  "Unable to [action] the [object]. Please try again."
 *   business: the server's own rule message (safe by contract), e.g.
 *             "Awaiting district verification before this can be closed"
 */
export interface Notice {
  code: string;
  message: string;
}

const n = (code: string, message: string): Notice => ({ code, message });

/** Standard create / update / delete / activate / deactivate messages for a record type. */
function entity(CODE: string, label: string) {
  const Label = label.charAt(0).toUpperCase() + label.slice(1);
  return {
    created: n(`${CODE}_CREATED`, `${Label} created successfully.`),
    updated: n(`${CODE}_UPDATED`, `${Label} updated successfully.`),
    deleted: n(`${CODE}_DELETED`, `${Label} deleted successfully.`),
    activated: n(`${CODE}_ACTIVATED`, `${Label} activated successfully.`),
    deactivated: n(`${CODE}_DEACTIVATED`, `${Label} deactivated successfully.`),
    createFailed: n(`${CODE}_CREATE_FAILED`, `Unable to create the ${label}. Please try again.`),
    updateFailed: n(`${CODE}_UPDATE_FAILED`, `Unable to update the ${label}. Please try again.`),
    deleteFailed: n(`${CODE}_DELETE_FAILED`, `Unable to delete the ${label}. Please try again.`),
    statusFailed: n(`${CODE}_STATUS_FAILED`, `Unable to change the ${label}'s status. Please try again.`),
  };
}

export const notifications = {
  finding: {
    ...entity("FINDING", "finding"),
    draftSaved: n("FINDING_DRAFT_SAVED", "Finding saved as draft."),
    submitted: n("FINDING_SUBMITTED", "Finding submitted successfully."),
    approved: n("FINDING_APPROVED", "Finding approved successfully."),
    rejected: n("FINDING_REJECTED", "Finding rejected."),
    returned: n("FINDING_RETURNED", "Finding returned for correction."),
    rectified: n("FINDING_RECTIFIED", "Rectification recorded successfully."),
    verified: n("FINDING_VERIFIED", "Rectification verified successfully."),
    closed: n("FINDING_CLOSED", "Finding closed successfully."),
    reversed: n("FINDING_REVERSED", "Finding reversed successfully."),
    rectificationReturned: n("FINDING_RECTIFICATION_RETURNED", "Rectification returned for correction."),
    rectificationResubmitted: n("FINDING_RECTIFICATION_RESUBMITTED", "Rectification resubmitted successfully."),
    partiallyClosed: n("FINDING_PARTIALLY_CLOSED", "Rectified portion closed successfully."),
    evidenceUploaded: n("FINDING_EVIDENCE_UPLOADED", "Evidence uploaded successfully."),
    evidenceRemoved: n("FINDING_EVIDENCE_REMOVED", "Evidence file removed successfully."),
    commentPosted: n("FINDING_COMMENT_POSTED", "Comment posted successfully."),
    reverseFailed: n("FINDING_REVERSE_FAILED", "Unable to reverse the finding. Please try again."),
    transferred: n("FINDING_TRANSFERRED", "Finding transferred successfully."),
    saveFailed: n("FINDING_SAVE_FAILED", "Unable to save the finding. Please try again."),
    submitFailed: n("FINDING_SUBMIT_FAILED", "Unable to submit the finding. Please try again."),
    reviewFailed: n("FINDING_REVIEW_FAILED", "Unable to record the decision on the finding. Please try again."),
    rectifyFailed: n("FINDING_RECTIFY_FAILED", "Unable to record the rectification. Please try again."),
    verifyFailed: n("FINDING_VERIFY_FAILED", "Unable to verify the rectification. Please try again."),
    closeFailed: n("FINDING_CLOSE_FAILED", "Unable to close the finding. Please try again."),
    returnRectificationFailed: n("FINDING_RETURN_RECTIFICATION_FAILED", "Unable to return the rectification. Please try again."),
    resubmitRectificationFailed: n("FINDING_RESUBMIT_RECTIFICATION_FAILED", "Unable to resubmit the rectification. Please try again."),
    transferFailed: n("FINDING_TRANSFER_FAILED", "Unable to transfer the finding. Please try again."),
    evidenceUploadFailed: n("FINDING_EVIDENCE_UPLOAD_FAILED", "Unable to upload the evidence. Please try again."),
    evidenceRemoveFailed: n("FINDING_EVIDENCE_REMOVE_FAILED", "Unable to remove the evidence file. Please try again."),
    commentFailed: n("FINDING_COMMENT_FAILED", "Unable to post the comment. Please try again."),
    bulkCompleted: n("FINDING_BULK_COMPLETED", "Bulk action completed successfully."),
    bulkFailed: n("FINDING_BULK_FAILED", "Unable to apply the action to some findings. Please try again."),
  },
  user: entity("USER", "user"),
  district: entity("DISTRICT", "district"),
  branch: entity("BRANCH", "branch"),
  department: entity("DEPARTMENT", "department"),
  category: {
    ...entity("CATEGORY", "category"),
    nowScored: n("CATEGORY_SCORED", "Category now counts toward performance."),
    notScored: n("CATEGORY_UNSCORED", "Category no longer counts toward performance."),
  },
  source: {
    ...entity("SOURCE", "source"),
    defaultSet: n("SOURCE_DEFAULT_SET", "Default source updated successfully."),
    defaultCleared: n("SOURCE_DEFAULT_CLEARED", "Default source cleared."),
    defaultFailed: n("SOURCE_DEFAULT_FAILED", "Unable to change the default source. Please try again."),
  },
  uncoveredReason: entity("UNCOVERED_REASON", "reason"),
  reportingPeriod: {
    ...entity("REPORTING_PERIOD", "reporting period"),
    locked: n("REPORTING_PERIOD_LOCKED", "Reporting period locked successfully."),
    unlocked: n("REPORTING_PERIOD_UNLOCKED", "Reporting period unlocked successfully."),
    lockFailed: n("REPORTING_PERIOD_LOCK_FAILED", "Unable to change the reporting period's lock. Please try again."),
    windowUpdated: n("REPORTING_PERIOD_WINDOW_UPDATED", "Submission window updated successfully."),
    windowUpdateFailed: n("REPORTING_PERIOD_WINDOW_UPDATE_FAILED", "Unable to update the submission window. Please try again."),
  },
  role: entity("ROLE", "role"),
  scoringRule: entity("SCORING_RULE", "scoring rule"),
  import: {
    completed: n("IMPORT_COMPLETED", "Import completed successfully."),
    cancelled: n("IMPORT_CANCELLED", "Import cancelled. Nothing was imported."),
    reversed: n("IMPORT_REVERSED", "Import reversed successfully."),
    reimported: n("IMPORT_REIMPORTED", "File re-imported successfully."),
    deleted: n("IMPORT_DELETED", "Import record deleted successfully."),
    failed: n("IMPORT_FAILED", "Unable to import the file. Please try again."),
    reverseFailed: n("IMPORT_REVERSE_FAILED", "Unable to reverse the import. Please try again."),
    reimportFailed: n("IMPORT_REIMPORT_FAILED", "Unable to re-import the file. Please try again."),
    deleteFailed: n("IMPORT_DELETE_FAILED", "Unable to delete the import record. Please try again."),
    impactFailed: n("IMPORT_IMPACT_FAILED", "Unable to check what the import affects. Please try again."),
  },
  csvImport: {
    completed: n("CSV_IMPORT_COMPLETED", "Rows imported successfully."),
    partialFailed: n("CSV_IMPORT_PARTIAL_FAILED", "Unable to import some rows. Please try again."),
  },
  uncoveredNote: {
    saved: n("UNCOVERED_NOTE_SAVED", "Reason saved successfully."),
    bulkSaved: n("UNCOVERED_NOTE_BULK_SAVED", "Reason applied to the selected branches successfully."),
    saveFailed: n("UNCOVERED_NOTE_SAVE_FAILED", "Unable to save the reason. Please try again."),
    bulkSaveFailed: n("UNCOVERED_NOTE_BULK_SAVE_FAILED", "Unable to apply the reason to the selected branches. Please try again."),
  },
  support: {
    replySent: n("SUPPORT_REPLY_SENT", "Message sent successfully."),
    rated: n("SUPPORT_RATED", "Thank you - your rating was saved."),
    loadFailed: n("SUPPORT_LOAD_FAILED", "Unable to load the conversations. Please try again."),
    sendFailed: n("SUPPORT_SEND_FAILED", "Unable to send the message. Please try again."),
    rateFailed: n("SUPPORT_RATE_FAILED", "Unable to save the rating. Please try again."),
  },
  settings: {
    saved: n("SETTINGS_SAVED", "Settings saved successfully."),
    saveFailed: n("SETTINGS_SAVE_FAILED", "Unable to save the settings. Please try again."),
    testEmailFailed: n("SETTINGS_TEST_EMAIL_FAILED", "Unable to send the test email. Please try again."),
  },
  auth: {
    loginSuccess: n("AUTH_LOGIN_SUCCESS", "Signed in successfully."),
    logoutSuccess: n("AUTH_LOGOUT_SUCCESS", "Signed out successfully."),
    passwordChanged: n("AUTH_PASSWORD_CHANGED", "Password changed successfully."),
    loginFailed: n("AUTH_LOGIN_FAILED", "Unable to sign in. Please try again."),
    logoutFailed: n("AUTH_LOGOUT_FAILED", "Unable to sign out. Please try again."),
    passwordChangeFailed: n("AUTH_PASSWORD_CHANGE_FAILED", "Unable to change the password. Please try again."),
    resetLinkFailed: n("AUTH_RESET_LINK_FAILED", "Unable to send the reset link. Please try again."),
    passwordReset: n("AUTH_PASSWORD_RESET", "Password reset successfully."),
    passwordResetFailed: n("AUTH_PASSWORD_RESET_FAILED", "Unable to reset the password. Please try again."),
    sessionExpired: n("AUTH_SESSION_EXPIRED", "Your session has expired. Please sign in again."),
  },
  devReset: {
    completed: n("DEV_RESET_COMPLETED", "Registered data reset successfully."),
    failed: n("DEV_RESET_FAILED", "Unable to reset the registered data. Please try again."),
  },
  generic: {
    fixFields: n("FORM_INVALID", "Please correct the highlighted fields."),
    noPermission: n("PERMISSION_DENIED", "You don't have permission to do that."),
    notFound: n("NOT_FOUND", "This item no longer exists. Refresh the page to see the latest data."),
    network: n("NETWORK_ERROR", "Can't reach the server. Check your connection and try again."),
    unknown: n("UNKNOWN_ERROR", "Something went wrong. Please try again."),
  },
} as const;

/**
 * Safe replacements for server-side failure codes. The server's own text
 * is never shown for these (it could be generic or, for 5xx, withheld).
 * The action-specific failure message is preferred when one is given.
 */
export const SAFE_SYSTEM_MESSAGES: Record<string, string> = {
  INTERNAL_SERVER_ERROR: "We couldn't complete your request. Please try again.",
  DATABASE_ERROR: "We couldn't save your changes. Please try again.",
  EXTERNAL_SERVICE_UNAVAILABLE: "The requested service is temporarily unavailable. Please try again later.",
  FILE_STORAGE_UNAVAILABLE: "File storage is temporarily unavailable. Please try again later.",
  UPSTREAM_TIMEOUT: "The request took too long. Please try again.",
  BAD_GATEWAY: "The requested service is temporarily unavailable. Please try again later.",
  NETWORK_ERROR: notifications.generic.network.message,
  UNKNOWN_ERROR: notifications.generic.unknown.message,
};
