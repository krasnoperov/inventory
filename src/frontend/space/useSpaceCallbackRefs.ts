import { useEffect, useMemo, useRef } from 'react';
import type { UseSpaceWebSocketParams } from './protocol';

export function useSpaceCallbackRefs({
  onConnect,
  onDisconnect,
  onJobComplete,
  onChatMessage,
  onChatResponse,
  onChatProgress,
  onGenerateStarted,
  onGenerateResult,
  onDescribeResponse,
  onCompareResponse,
  onApprovalCreated,
  onApprovalUpdated,
  onApprovalList,
  onAutoExecuted,
  onSessionState,
  onChatHistory,
  onPersistentChatMessage,
  onPersistentChatProgress,
  onSessionCreated,
  onPlanUpdated,
  onPlanArchived,
  onBatchStarted,
  onBatchProgress,
  onBatchCompleted,
  onGenerationEstimate,
  onRotationStarted,
  onRotationStepCompleted,
  onRotationCompleted,
  onRotationFailed,
  onRotationCancelled,
  onTileSetStarted,
  onTileSetTileCompleted,
  onTileSetCompleted,
  onTileSetFailed,
  onTileSetCancelled,
  onGenerateError,
  onRefineError,
  onBatchError,
  onError,
  sessionUpdateOnConnect,
}: UseSpaceWebSocketParams) {
  // Store callbacks in refs to avoid dependency issues
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  const onJobCompleteRef = useRef(onJobComplete);
  const onChatMessageRef = useRef(onChatMessage);
  const onChatResponseRef = useRef(onChatResponse);
  const onChatProgressRef = useRef(onChatProgress);
  const onGenerateStartedRef = useRef(onGenerateStarted);
  const onGenerateResultRef = useRef(onGenerateResult);
  const onDescribeResponseRef = useRef(onDescribeResponse);
  const onCompareResponseRef = useRef(onCompareResponse);
  const onApprovalCreatedRef = useRef(onApprovalCreated);
  const onApprovalUpdatedRef = useRef(onApprovalUpdated);
  const onApprovalListRef = useRef(onApprovalList);
  const onAutoExecutedRef = useRef(onAutoExecuted);
  const onSessionStateRef = useRef(onSessionState);
  const onChatHistoryRef = useRef(onChatHistory);
  const onPersistentChatMessageRef = useRef(onPersistentChatMessage);
  const onPersistentChatProgressRef = useRef(onPersistentChatProgress);
  const onSessionCreatedRef = useRef(onSessionCreated);
  const onPlanUpdatedRef = useRef(onPlanUpdated);
  const onPlanArchivedRef = useRef(onPlanArchived);
  const onBatchStartedRef = useRef(onBatchStarted);
  const onBatchProgressRef = useRef(onBatchProgress);
  const onBatchCompletedRef = useRef(onBatchCompleted);
  const onGenerationEstimateRef = useRef(onGenerationEstimate);
  const onRotationStartedRef = useRef(onRotationStarted);
  const onRotationStepCompletedRef = useRef(onRotationStepCompleted);
  const onRotationCompletedRef = useRef(onRotationCompleted);
  const onRotationFailedRef = useRef(onRotationFailed);
  const onRotationCancelledRef = useRef(onRotationCancelled);
  const onTileSetStartedRef = useRef(onTileSetStarted);
  const onTileSetTileCompletedRef = useRef(onTileSetTileCompleted);
  const onTileSetCompletedRef = useRef(onTileSetCompleted);
  const onTileSetFailedRef = useRef(onTileSetFailed);
  const onTileSetCancelledRef = useRef(onTileSetCancelled);
  const onGenerateErrorRef = useRef(onGenerateError);
  const onRefineErrorRef = useRef(onRefineError);
  const onBatchErrorRef = useRef(onBatchError);
  const onErrorRef = useRef(onError);
  const sessionUpdateOnConnectRef = useRef(sessionUpdateOnConnect);

  // Update refs in useEffect to avoid accessing refs during render
  useEffect(() => {
    onConnectRef.current = onConnect;
    onDisconnectRef.current = onDisconnect;
    onJobCompleteRef.current = onJobComplete;
    onChatMessageRef.current = onChatMessage;
    onChatResponseRef.current = onChatResponse;
    onChatProgressRef.current = onChatProgress;
    onGenerateStartedRef.current = onGenerateStarted;
    onGenerateResultRef.current = onGenerateResult;
    onDescribeResponseRef.current = onDescribeResponse;
    onCompareResponseRef.current = onCompareResponse;
    onApprovalCreatedRef.current = onApprovalCreated;
    onApprovalUpdatedRef.current = onApprovalUpdated;
    onApprovalListRef.current = onApprovalList;
    onAutoExecutedRef.current = onAutoExecuted;
    onSessionStateRef.current = onSessionState;
    onChatHistoryRef.current = onChatHistory;
    onPersistentChatMessageRef.current = onPersistentChatMessage;
    onPersistentChatProgressRef.current = onPersistentChatProgress;
    onSessionCreatedRef.current = onSessionCreated;
    onPlanUpdatedRef.current = onPlanUpdated;
    onPlanArchivedRef.current = onPlanArchived;
    onBatchStartedRef.current = onBatchStarted;
    onBatchProgressRef.current = onBatchProgress;
    onBatchCompletedRef.current = onBatchCompleted;
    onGenerationEstimateRef.current = onGenerationEstimate;
    onRotationStartedRef.current = onRotationStarted;
    onRotationStepCompletedRef.current = onRotationStepCompleted;
    onRotationCompletedRef.current = onRotationCompleted;
    onRotationFailedRef.current = onRotationFailed;
    onRotationCancelledRef.current = onRotationCancelled;
    onTileSetStartedRef.current = onTileSetStarted;
    onTileSetTileCompletedRef.current = onTileSetTileCompleted;
    onTileSetCompletedRef.current = onTileSetCompleted;
    onTileSetFailedRef.current = onTileSetFailed;
    onTileSetCancelledRef.current = onTileSetCancelled;
    onGenerateErrorRef.current = onGenerateError;
    onRefineErrorRef.current = onRefineError;
    onBatchErrorRef.current = onBatchError;
    onErrorRef.current = onError;
    sessionUpdateOnConnectRef.current = sessionUpdateOnConnect;
  });

  return useMemo(() => ({
    onConnectRef,
    onDisconnectRef,
    onJobCompleteRef,
    onChatMessageRef,
    onChatResponseRef,
    onChatProgressRef,
    onGenerateStartedRef,
    onGenerateResultRef,
    onDescribeResponseRef,
    onCompareResponseRef,
    onApprovalCreatedRef,
    onApprovalUpdatedRef,
    onApprovalListRef,
    onAutoExecutedRef,
    onSessionStateRef,
    onChatHistoryRef,
    onPersistentChatMessageRef,
    onPersistentChatProgressRef,
    onSessionCreatedRef,
    onPlanUpdatedRef,
    onPlanArchivedRef,
    onBatchStartedRef,
    onBatchProgressRef,
    onBatchCompletedRef,
    onGenerationEstimateRef,
    onRotationStartedRef,
    onRotationStepCompletedRef,
    onRotationCompletedRef,
    onRotationFailedRef,
    onRotationCancelledRef,
    onTileSetStartedRef,
    onTileSetTileCompletedRef,
    onTileSetCompletedRef,
    onTileSetFailedRef,
    onTileSetCancelledRef,
    onGenerateErrorRef,
    onRefineErrorRef,
    onBatchErrorRef,
    onErrorRef,
    sessionUpdateOnConnectRef,
  }), []);
}

export type SpaceCallbackRefs = ReturnType<typeof useSpaceCallbackRefs>;
