import { useAction, useMutation, useQuery } from 'convex/react';
import { useQueryResult } from '../../../hooks/useQueryResult';
import { useEffect, useMemo, useState } from 'react';
import { t } from '@lingui/core/macro';
import { authClient } from '../../../lib/authClient';
import { ChecklistItem } from '../../../components/OnboardingChecklist';
import { useToast } from '../../../components/ToastProvider';
import { api } from '../../../../convex/_generated/api';
import { Room, RoomAccess, RoomType } from '../../../types';
import { AdminTab, SettingsTab } from '../types';

type UseAdminControllerArgs = {
  rooms: Room[];
  onCreateRoom: (room: Room) => Promise<void>;
  onUpdateRoom: (room: Room) => Promise<void>;
  onDeleteRoom: (roomId: string) => Promise<void>;
  initialTab?: AdminTab;
};

export const useAdminController = ({
  rooms,
  onCreateRoom,
  onUpdateRoom,
  onDeleteRoom,
  initialTab = 'OVERVIEW',
}: UseAdminControllerArgs) => {
  const toast = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('PROFILE');
  const [selectedRoomForNotes, setSelectedRoomForNotes] = useState<Room | null>(null);
  const [confirmDeleteRoom, setConfirmDeleteRoom] = useState<Room | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [roomsSearchInput, setRoomsSearchInput] = useState('');
  const [roomsSearchTerm, setRoomsSearchTerm] = useState('');

  const [showTour, setShowTour] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [completedTasks, setCompletedTasks] = useState<string[]>([]);
  const [profileName, setProfileName] = useState('');
  const [profileAvatarUrl, setProfileAvatarUrl] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  // The same subscription as appState. The rooms prop arrives as [] while loading, which reads as "no rooms".
  const roomsResult = useQueryResult(api.rooms.list, {});
  const roomsLoading = roomsResult === undefined;
  const roomsFailed = roomsResult instanceof Error;
  const orgs = useQuery(api.organizations.listForCurrentUser, {}) || [];
  const activeOrg = orgs[0] as any | undefined;

  const ensureUser = useMutation(api.users.ensureCurrentUser);
  const [userEnsured, setUserEnsured] = useState(false);
  useEffect(() => {
    if (!userEnsured) {
      ensureUser({}).then(() => setUserEnsured(true)).catch(console.error);
    }
  }, [ensureUser, userEnsured]);

  const me = useQuery(api.users.me, userEnsured ? {} : 'skip') as any;
  const billing = useQuery(api.billing.getForOrg, {}) as any;
  const analyticsResult = useQueryResult(api.analytics.overview, {});
  const analyticsFailed = analyticsResult instanceof Error;
  const analytics = (analyticsFailed ? undefined : analyticsResult) as any;
  const notesAvailability = useQuery(
    api.meetingDoc.listAvailabilityForRooms,
    rooms.length > 0 ? { roomIds: rooms.map(room => room.id) } : 'skip'
  ) as Record<string, boolean> | undefined;
  const recordingsResult = useQueryResult(api.recordings.listForOrg, {});
  const recordingsFailed = recordingsResult instanceof Error;
  const recordings = (recordingsFailed ? undefined : recordingsResult) as any[] | undefined;
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
  const selectedRecording = useMemo(
    () => recordings?.find(recording => recording.id === selectedRecordingId) ?? null,
    [recordings, selectedRecordingId],
  );
  const selectedRecordingDetails = useQuery(
    api.recordings.getById,
    selectedRecordingId ? { id: selectedRecordingId as any } : 'skip',
  ) as any;
  const selectedRecordingTranscript = useQuery(
    api.recordings.transcriptForRecording,
    selectedRecordingId ? { recordingId: selectedRecordingId as any } : 'skip',
  ) as any;
  const getRecordingDownloadUrl = useAction(api.recordingActions.getDownloadUrl);
  const [selectedRecordingVideoUrl, setSelectedRecordingVideoUrl] = useState<string | null>(null);
  const selectedRoomDoc = useQuery(
    api.meetingDoc.get,
    selectedRoomForNotes ? { roomId: selectedRoomForNotes.id } : 'skip'
  ) as { contentHtml: string } | null | undefined;
  const updateMe = useMutation(api.users.updateMe);
  const createCheckoutSession = useAction(api.billingActions.createCheckoutSession);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);

  const onboardingStorageKey = useMemo(() => {
    if (!me) return null;
    const userKey = me.externalId ?? me.id ?? 'unknown';
    const orgKey = activeOrg?.id ?? 'no-org';
    return `admin_onboarding:${userKey}:${orgKey}`;
  }, [me, activeOrg?.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => setRoomsSearchTerm(roomsSearchInput.trim().toLowerCase()), 150);
    return () => window.clearTimeout(timer);
  }, [roomsSearchInput]);

  const filteredRooms = useMemo(() => {
    if (!roomsSearchTerm) return rooms;
    return rooms.filter(room =>
      room.name.toLowerCase().includes(roomsSearchTerm) ||
      room.slug.toLowerCase().includes(roomsSearchTerm)
    );
  }, [rooms, roomsSearchTerm]);

  useEffect(() => {
    if (!me) return;
    setProfileName(me.name ?? '');
    setProfileAvatarUrl(me.avatarUrl ?? '');
  }, [me]);

  useEffect(() => {
    if (!onboardingStorageKey) return;
    try {
      const raw = window.localStorage.getItem(onboardingStorageKey);
      if (!raw) {
        setShowTour(true);
        setShowChecklist(true);
        return;
      }
      const parsed = JSON.parse(raw) as { tourCompleted?: boolean; checklistDismissed?: boolean } | null;
      setShowTour(!parsed?.tourCompleted);
      setShowChecklist(!parsed?.checklistDismissed);
    } catch {
      setShowTour(true);
      setShowChecklist(true);
    }
  }, [onboardingStorageKey]);

  const persistOnboardingState = (next: { tourCompleted?: boolean; checklistDismissed?: boolean }) => {
    if (!onboardingStorageKey) return;
    try {
      const raw = window.localStorage.getItem(onboardingStorageKey);
      const current = raw ? (JSON.parse(raw) as { tourCompleted?: boolean; checklistDismissed?: boolean }) : {};
      window.localStorage.setItem(onboardingStorageKey, JSON.stringify({ ...current, ...next }));
    } catch {
      // Ignore storage failures to avoid blocking core UI.
    }
  };

  const completeTask = (taskId: string) => {
    if (!completedTasks.includes(taskId)) {
      setCompletedTasks(prev => [...prev, taskId]);
    }
  };

  const checklistItems: ChecklistItem[] = [
    {
      id: 'create-room',
      label: t`Create your first room`,
      isCompleted: rooms.length > 0 || completedTasks.includes('create-room'),
      action: () => { setModalOpen(true); }
    },
    {
      id: 'update-profile',
      label: t`Customize your profile`,
      isCompleted: completedTasks.includes('update-profile'),
      action: () => { setActiveTab('SETTINGS'); setSettingsTab('PROFILE'); }
    },
    {
      id: 'check-billing',
      label: t`Review billing settings`,
      isCompleted: completedTasks.includes('check-billing'),
      action: () => { setActiveTab('SETTINGS'); setSettingsTab('BILLING'); }
    },
  ];

  const handleOpenCreate = () => {
    setEditingRoom(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (room: Room) => {
    setEditingRoom(room);
    setModalOpen(true);
  };

  const handleSaveRoom = async (roomData: Partial<Room>) => {
    try {
      if (editingRoom) {
        const updatedRoom: Room = {
          ...editingRoom,
          ...roomData,
          branding: roomData.branding || editingRoom.branding
        } as Room;
        await onUpdateRoom(updatedRoom);
        toast.success(t`Room updated`);
      } else {
        const newRoom: Room = {
          id: Date.now().toString(),
          name: roomData.name || t`Untitled Room`,
          slug: roomData.slug || 'untitled',
          type: roomData.type || RoomType.PERSONAL,
          access: roomData.access || RoomAccess.OPEN,
          password: roomData.password,
          activeParticipants: 0,
          maxParticipants: 50,
          locked: false,
          recording: false,
          createdAt: new Date().toISOString().split('T')[0],
          branding: roomData.branding
        };
        await onCreateRoom(newRoom);
        completeTask('create-room');
        toast.success(t`Room created`);
      }
      setModalOpen(false);
    } catch (err: any) {
      toast.error(err?.data?.message || err?.message || t`Could not save room`);
    }
  };

  const handleSaveProfile = async () => {
    setProfileSaving(true);
    try {
      await updateMe({
        name: profileName.trim(),
        avatarUrl: profileAvatarUrl.trim(),
      });
      completeTask('update-profile');
      toast.success(t`Profile updated`);
    } catch (err: any) {
      toast.error(err?.message || t`Failed to update profile`);
    } finally {
      setProfileSaving(false);
    }
  };

  const handleRequestDeleteRoom = (room: Room) => {
    setConfirmDeleteRoom(room);
  };

  const handleConfirmDeleteRoom = async () => {
    if (!confirmDeleteRoom) return;
    try {
      await onDeleteRoom(confirmDeleteRoom.id);
      toast.success(t`Deleted room "${confirmDeleteRoom.name}"`);
      setConfirmDeleteRoom(null);
    } catch (err: any) {
      toast.error(err?.message || t`Failed to delete room`);
    }
  };

  const handleCopyRoomLink = async (room: Room) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/room/${room.slug}`);
      toast.success(t`Copied /room/${room.slug}`);
    } catch {
      toast.error(t`Could not copy room link`);
    }
  };

  const handleOpenNotes = (room: Room) => {
    setSelectedRoomForNotes(room);
  };

  const handleDismissTour = () => {
    setShowTour(false);
    persistOnboardingState({ tourCompleted: true });
  };

  const handleDismissChecklist = () => {
    setShowChecklist(false);
    persistOnboardingState({ checklistDismissed: true });
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    const result = await authClient.signOut().catch(() => null);
    if (!result || result.error) {
      toast.error(t`Could not sign out. Please try again.`);
      setSigningOut(false);
      return;
    }
    // A full load, so no state of this account carries over into the next sign-in.
    window.location.assign('/');
  };

  const handleRestartOnboarding = () => {
    if (onboardingStorageKey) {
      window.localStorage.removeItem(onboardingStorageKey);
    }
    setShowTour(true);
    setShowChecklist(true);
  };

  const handleUpgradeToPro = async () => {
    if (!activeOrg) {
      setBillingError(t`Workspace is not ready yet`);
      toast.error(t`Workspace is not ready yet`);
      return;
    }
    setBillingLoading(true);
    setBillingError(null);
    try {
      const result = await createCheckoutSession({ planId: 'pro' });
      const url = (result as any)?.url;
      if (url && typeof window !== 'undefined') {
        window.location.href = url;
      } else {
        setBillingError(t`Upgrade is not available right now`);
        toast.error(t`Upgrade is not available right now`);
      }
    } catch (err: any) {
      console.error('Failed to create checkout session', err);
      setBillingError(err?.message || t`Unable to start upgrade`);
      toast.error(err?.message || t`Unable to start upgrade`);
    } finally {
      setBillingLoading(false);
    }
  };

  const openBillingTab = () => {
    setSettingsTab('BILLING');
    completeTask('check-billing');
  };

  const handleOpenRecording = async (recording: { id: string }) => {
    setSelectedRecordingId(recording.id);
    setSelectedRecordingVideoUrl(null);
    try {
      const url = await getRecordingDownloadUrl({ recordingId: recording.id as any });
      if (typeof url === 'string') setSelectedRecordingVideoUrl(url);
    } catch {
      // Keep the viewer usable when a recording is still processing or its object has expired.
    }
  };

  return {
    activeTab,
    setActiveTab,
    settingsTab,
    setSettingsTab,
    selectedRoomForNotes,
    setSelectedRoomForNotes,
    confirmDeleteRoom,
    setConfirmDeleteRoom,
    modalOpen,
    setModalOpen,
    editingRoom,
    roomsSearchInput,
    setRoomsSearchInput,
    roomsSearchTerm,
    showTour,
    showChecklist,
    checklistItems,
    profileName,
    setProfileName,
    profileAvatarUrl,
    setProfileAvatarUrl,
    profileSaving,
    activeOrg,
    roomsLoading,
    roomsFailed,
    me,
    billing,
    analytics,
    analyticsFailed,
    notesAvailability,
    recordings,
    recordingsFailed,
    selectedRecording: selectedRecordingDetails || selectedRecording
      ? { ...(selectedRecordingDetails ?? selectedRecording), ...(selectedRecordingVideoUrl ? { videoUrl: selectedRecordingVideoUrl } : {}) }
      : null,
    selectedRecordingId,
    selectedRecordingTranscript,
    setSelectedRecordingId,
    selectedRoomDoc,
    billingLoading,
    billingError,
    filteredRooms,
    handleOpenCreate,
    handleOpenEdit,
    handleSaveRoom,
    handleSaveProfile,
    handleRequestDeleteRoom,
    handleConfirmDeleteRoom,
    handleCopyRoomLink,
    handleOpenNotes,
    handleDismissTour,
    handleDismissChecklist,
    handleRestartOnboarding,
    handleSignOut,
    signingOut,
    handleUpgradeToPro,
    openBillingTab,
    handleOpenRecording,
  };
};
