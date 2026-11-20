import React, { useEffect, useId, useMemo, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { Image as ImageIcon, Search, X } from 'lucide-react';
import { useMutation, useQuery } from 'convex/react';
import { useQueryResult, withoutError } from '../../../../hooks/useQueryResult';
import { api } from '../../../../../convex/_generated/api';
import { Badge, Button, Groove, IconButton, Input, Modal, Notice } from '../../../../components/ui';
import { useToast } from '../../../../components/ToastProvider';
import { Room, RoomAccess, RoomBranding, RoomType, toRoomSlug } from '../../../../types';
import { RoomMembershipEditor } from '../RoomMembershipEditor';

type RoomModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Partial<Room>) => Promise<void>;
  initialData?: Room;
  rooms: Room[];
  onOpenBilling?: () => void;
};

type ValidationErrors = {
  name?: string;
  slug?: string;
  password?: string;
  logo?: string;
  background?: string;
};

const createDefaultBranding = (): RoomBranding => ({
  // Empty means the room has no colour of its own and its join action stays the default ink.
  primaryColor: '',
  theme: 'light',
  logoUrl: '',
  partnerWebsiteUrl: '',
  backgroundImageUrl: '',
  logoFetchStatus: 'idle',
});

const mergeBranding = (branding?: RoomBranding): RoomBranding => ({
  ...createDefaultBranding(),
  ...branding,
});

const getLogoStatusLabel = (status?: RoomBranding['logoFetchStatus']) => {
  if (status === 'pending') return t`Auto-search running`;
  if (status === 'success') return t`Logo ready`;
  if (status === 'failed') return t`Auto-search failed`;
  return t`Awaiting source`;
};


// A colour input only takes #rrggbb. It needs a value while the room has no colour of its own.
const COLOR_PICKER_START = '#000000';
const isHexColor = (value?: string): value is string => !!value && /^#[0-9a-f]{6}$/i.test(value);

export const RoomModal: React.FC<RoomModalProps> = ({ isOpen, onClose, onSave, initialData, rooms, onOpenBilling }) => {
  const toast = useToast();
  const colorFieldId = useId();
  const [formData, setFormData] = useState<Partial<Room>>({
    name: '',
    slug: '',
    type: RoomType.WORKSPACE,
    access: RoomAccess.OPEN,
    password: '',
    branding: createDefaultBranding(),
  });
  const [uploadingBackground, setUploadingBackground] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [requestingLogoDiscovery, setRequestingLogoDiscovery] = useState(false);
  const [backgroundPreview, setBackgroundPreview] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});

  const generateBackgroundUploadUrl = useMutation(api.uploads.generateBackgroundUploadUrl);
  const saveBackgroundImage = useMutation(api.uploads.saveBackgroundImage);
  const generateLogoUploadUrl = useMutation(api.uploads.generateLogoUploadUrl);
  const saveLogoImage = useMutation(api.uploads.saveLogoImage);
  const requestLogoDiscovery = useMutation(api.rooms.requestLogoDiscovery);
  const subscription = useQuery(api.billing.getForOrg, {});
  const normalizedSlug = (formData.slug || '').trim().toLowerCase();
  // Only a hint: the server checks the slug again on save, so a failed check must not take the form down.
  const slugAvailability = withoutError(useQueryResult(
    api.rooms.isSlugAvailable,
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedSlug)
      ? { slug: normalizedSlug, excludeRoomId: initialData?.id as never }
      : 'skip',
  ));

  const planId = subscription?.planId || 'free';
  const maxRooms = planId === 'business' ? 100 : planId === 'pro' ? 20 : 3;
  const roomsUsed = rooms.length;
  const isAtLimit = roomsUsed >= maxRooms;

  const mergedBranding = useMemo(() => mergeBranding(formData.branding), [formData.branding]);
  const effectiveLogoPreview = logoPreview || mergedBranding.logoUrl || null;
  const effectiveBackgroundPreview = backgroundPreview || mergedBranding.backgroundImageUrl || null;
  const canTriggerDiscovery = !!mergedBranding.partnerWebsiteUrl?.trim() && !!initialData?.id;

  useEffect(() => {
    if (initialData) {
      setFormData({
        ...initialData,
        branding: mergeBranding(initialData.branding),
      });
      setBackgroundPreview(initialData.branding?.backgroundImageUrl || null);
      setLogoPreview(initialData.branding?.logoUrl || null);
      return;
    }

    setFormData({
      name: '',
      slug: '',
      type: RoomType.WORKSPACE,
      access: RoomAccess.OPEN,
      password: '',
      branding: createDefaultBranding(),
    });
    setBackgroundPreview(null);
    setLogoPreview(null);
    setValidationErrors({});
  }, [initialData, isOpen]);

  const validateSlug = (value: string): string | undefined => {
    const slug = value.trim().toLowerCase();
    if (!slug) return t`Slug is required`;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return t`Use lowercase letters, numbers, and hyphens only`;
    }
    const duplicate = rooms.some(room => room.slug.toLowerCase() === slug && room.id !== initialData?.id);
    if (duplicate) {
      return t`This slug is already in use`;
    }
    return undefined;
  };

  const setBranding = (next: Partial<RoomBranding> | ((current: RoomBranding) => RoomBranding)) => {
    setFormData(prev => {
      const currentBranding = mergeBranding(prev.branding);
      const resolvedBranding = typeof next === 'function' ? next(currentBranding) : { ...currentBranding, ...next };
      return {
        ...prev,
        branding: resolvedBranding,
      };
    });
  };

  const updateBrandingField = (field: keyof RoomBranding, value: string) => {
    setBranding({ [field]: value } as Partial<RoomBranding>);
  };

  const clearManualLogo = () => {
    setBranding(current => ({
      ...current,
      logoUrl: '',
      logoStorageId: undefined,
      logoSource: undefined,
      logoFetchStatus: current.partnerWebsiteUrl ? 'idle' : undefined,
      logoFetchError: undefined,
      logoFetchedAt: undefined,
    }));
    setLogoPreview(null);
  };

  const setManualLogoUrl = (value: string) => {
    setBranding(current => ({
      ...current,
      logoUrl: value,
      logoStorageId: undefined,
      logoSource: value.trim() ? 'manual_url' : undefined,
      logoFetchStatus: value.trim() ? 'success' : current.partnerWebsiteUrl ? 'idle' : undefined,
      logoFetchError: undefined,
      logoFetchedAt: value.trim() ? new Date().toISOString() : undefined,
    }));
    setLogoPreview(value || null);
    setValidationErrors(prev => ({ ...prev, logo: undefined }));
  };

  const handleBackgroundFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setValidationErrors(prev => ({ ...prev, background: t`Please select an image file.` }));
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setValidationErrors(prev => ({ ...prev, background: t`Image must be less than 5MB.` }));
      return;
    }

    setValidationErrors(prev => ({ ...prev, background: undefined }));
    setUploadingBackground(true);

    try {
      const uploadUrl = await generateBackgroundUploadUrl();
      const uploadResult = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      if (!uploadResult.ok) {
        throw new Error(t`Upload failed`);
      }

      const { storageId } = await uploadResult.json();
      const publicUrl = await saveBackgroundImage({ storageId });

      if (publicUrl) {
        setBranding(current => ({
          ...current,
          backgroundImageUrl: publicUrl,
          backgroundStorageId: storageId,
        }));
        setBackgroundPreview(publicUrl);
      }
    } catch (error) {
      console.error('Background upload failed:', error);
      setValidationErrors(prev => ({ ...prev, background: t`Failed to upload background image. Please try again.` }));
    } finally {
      setUploadingBackground(false);
      e.target.value = '';
    }
  };

  const handleLogoFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setValidationErrors(prev => ({ ...prev, logo: t`Please select an image file.` }));
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setValidationErrors(prev => ({ ...prev, logo: t`Image must be less than 5MB.` }));
      return;
    }

    setValidationErrors(prev => ({ ...prev, logo: undefined }));
    setUploadingLogo(true);

    try {
      const uploadUrl = await generateLogoUploadUrl();
      const uploadResult = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      if (!uploadResult.ok) {
        throw new Error(t`Upload failed`);
      }

      const { storageId } = await uploadResult.json();
      const publicUrl = await saveLogoImage({ storageId });

      if (publicUrl) {
        setBranding(current => ({
          ...current,
          logoUrl: publicUrl,
          logoStorageId: storageId,
          logoSource: 'manual_upload',
          logoFetchStatus: 'success',
          logoFetchError: undefined,
          logoFetchedAt: new Date().toISOString(),
        }));
        setLogoPreview(publicUrl);
      }
    } catch (error) {
      console.error('Logo upload failed:', error);
      setValidationErrors(prev => ({ ...prev, logo: t`Failed to upload logo image. Please try again.` }));
    } finally {
      setUploadingLogo(false);
      e.target.value = '';
    }
  };

  const handleRequestLogoDiscovery = async () => {
    if (!initialData?.id) {
      return;
    }
    if (!mergedBranding.partnerWebsiteUrl?.trim()) {
      setValidationErrors(prev => ({ ...prev, logo: t`Add a partner website first.` }));
      return;
    }

    setRequestingLogoDiscovery(true);
    try {
      await requestLogoDiscovery({ roomId: initialData.id as never });
      setBranding(current => ({
        ...current,
        logoFetchStatus: 'pending',
        logoFetchError: undefined,
      }));
      toast.info(t`Automatic logo search started`);
    } catch (error: any) {
      const message = error?.message || t`Failed to start automatic logo search`;
      setBranding(current => ({
        ...current,
        logoFetchStatus: 'failed',
        logoFetchError: message,
      }));
      toast.error(message);
    } finally {
      setRequestingLogoDiscovery(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: ValidationErrors = {};
    if (!formData.name?.trim()) errors.name = t`Room name is required`;
    const slugError = validateSlug(formData.slug || '');
    if (slugError) errors.slug = slugError;
    if (!slugError && slugAvailability === false) errors.slug = t`This slug is already in use`;
    // Existing password rooms keep their password when the field is left empty.
    const needsPassword = formData.access === RoomAccess.PASSWORD && initialData?.access !== RoomAccess.PASSWORD;
    if (needsPassword && !formData.password?.trim()) errors.password = t`Set a password for this room`;
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors({});
    await onSave({
      ...formData,
      branding: mergedBranding,
    });
  };

  const title = initialData ? t`Edit Room` : t`Create New Room`;

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel={title} className="panel dash-roompanel">
      <div className="panel__head">
        <h2 className="dash-roompanel__title">{title}</h2>
        <IconButton label={t`Close`} onClick={onClose}><X className="icon" aria-hidden="true" /></IconButton>
      </div>

      <div className="panel__body">
        {!initialData && (
          <>
            <p className="dash-usage">
              <span>
                <Trans>Rooms: {roomsUsed}/{maxRooms}</Trans>
                <span className="muted"> · <Trans>{planId.charAt(0).toUpperCase() + planId.slice(1)} Plan</Trans></span>
              </span>
              {planId === 'free' && onOpenBilling && (
                <button type="button" className="link" onClick={onOpenBilling}><Trans>Upgrade to Pro</Trans></button>
              )}
            </p>
            {isAtLimit && (
              <Notice variant="error" className="dash-limit">
                <Trans>You've reached the room limit. Please upgrade your plan to create more rooms.</Trans>
              </Notice>
            )}
          </>
        )}

        <form id="room-form" onSubmit={handleSave}>
          <section className="dash-fieldset">
            <h3 className="dash-fieldset__title"><Trans>General Settings</Trans></h3>
            <div className="dash-fields">
              <Input
                label={t`Room Name`}
                placeholder={t`e.g. Weekly Standup`}
                value={formData.name}
                onChange={e => {
                  const name = e.target.value;
                  // While creating, keep deriving the slug from the name until the slug is edited by hand.
                  const followsName = !initialData && (formData.slug || '') === toRoomSlug(formData.name || '');
                  const slug = followsName ? toRoomSlug(name) : formData.slug;
                  setFormData({ ...formData, name, slug });
                  setValidationErrors(v => ({ ...v, name: undefined, ...(followsName && slug ? { slug: validateSlug(slug) } : {}) }));
                }}
                error={validationErrors.name}
              />
              <Input
                label={t`Slug (URL)`}
                placeholder={t`e.g. weekly-standup`}
                value={formData.slug}
                onChange={e => {
                  const nextSlug = e.target.value.toLowerCase().replace(/\s+/g, '-');
                  setFormData({ ...formData, slug: nextSlug });
                  setValidationErrors(v => ({ ...v, slug: validateSlug(nextSlug) }));
                }}
                error={validationErrors.slug}
                helperText={!validationErrors.slug ? t`Lowercase letters, numbers, and hyphens only` : undefined}
              />
            </div>

            <div className="field">
              <span className="field__label"><Trans>Room Type (optional label)</Trans></span>
              <Groove<RoomType>
                wide
                ariaLabel={t`Room Type (optional label)`}
                value={formData.type ?? RoomType.WORKSPACE}
                onChange={type => setFormData({ ...formData, type })}
                options={[
                  { value: RoomType.WORKSPACE, label: <Trans>Workspace</Trans> },
                  { value: RoomType.PERSONAL, label: <Trans>Personal</Trans> },
                  { value: RoomType.HANGOUT, label: <Trans>Hangout</Trans> },
                ]}
              />
            </div>

            <div className="field">
              <span className="field__label"><Trans>Who can join?</Trans></span>
              <Groove<RoomAccess>
                wide
                className="dash-groove-stack"
                ariaLabel={t`Who can join?`}
                value={formData.access ?? RoomAccess.OPEN}
                onChange={access => setFormData({ ...formData, access })}
                options={[
                  { value: RoomAccess.MEMBERS, label: <Trans>Members only</Trans> },
                  { value: RoomAccess.OPEN, label: <Trans>Public link</Trans> },
                  { value: RoomAccess.PASSWORD, label: <Trans>Password protected</Trans> },
                ]}
              />
              <p className="field__help">
                {formData.access === RoomAccess.MEMBERS
                  ? <Trans>Workspace members only</Trans>
                  : formData.access === RoomAccess.PASSWORD
                    ? <Trans>Public link with passcode</Trans>
                    : <Trans>Public link (host required)</Trans>}
              </p>
            </div>

            {formData.access === RoomAccess.PASSWORD && (
              <Input
                label={t`Room password`}
                placeholder={t`Set password`}
                type="password"
                value={formData.password}
                onChange={e => { setFormData({ ...formData, password: e.target.value }); setValidationErrors(v => ({ ...v, password: undefined })); }}
                error={validationErrors.password}
              />
            )}

            {initialData && formData.access === RoomAccess.MEMBERS && (
              <RoomMembershipEditor roomId={initialData.id} />
            )}
          </section>

          <section className="dash-fieldset">
            <h3 className="dash-fieldset__title"><Trans>Branding & Theme</Trans></h3>

            <div className="dash-fields">
              <div className="field">
                <label className="field__label" htmlFor={colorFieldId}><Trans>Primary Color</Trans></label>
                <div className="dash-color">
                  <input
                    id={colorFieldId}
                    className="input fig dash-color__hex"
                    placeholder={t`Default`}
                    value={mergedBranding.primaryColor || ''}
                    onChange={e => updateBrandingField('primaryColor', e.target.value)}
                  />
                  <span className="dash-color__swatch" style={mergedBranding.primaryColor ? { backgroundColor: mergedBranding.primaryColor } : undefined}>
                    <input
                      type="color"
                      aria-label={t`Primary Color`}
                      value={isHexColor(mergedBranding.primaryColor) ? mergedBranding.primaryColor : COLOR_PICKER_START}
                      onChange={e => updateBrandingField('primaryColor', e.target.value)}
                    />
                  </span>
                </div>
              </div>

              <div className="field">
                <span className="field__label"><Trans>Theme Mode</Trans></span>
                <Groove
                  wide
                  ariaLabel={t`Theme Mode`}
                  value={mergedBranding.theme === 'dark' ? 'dark' : 'light'}
                  onChange={theme => updateBrandingField('theme', theme)}
                  options={[
                    { value: 'light', label: <Trans>Light Mode</Trans> },
                    { value: 'dark', label: <Trans>Dark Mode</Trans> },
                  ]}
                />
              </div>
            </div>

            <Input
              label={t`Partner Website`}
              placeholder="example.com"
              value={mergedBranding.partnerWebsiteUrl || ''}
              onChange={e => setBranding(current => ({
                ...current,
                partnerWebsiteUrl: e.target.value,
                logoFetchStatus: current.logoUrl ? current.logoFetchStatus : e.target.value.trim() ? 'idle' : undefined,
                logoFetchError: undefined,
              }))}
              helperText={t`Used for automatic logo discovery. Domains without https:// are supported.`}
            />

            <div className="dash-subfield">
              <div className="dash-subfield__head">
                <div className="min-w-0">
                  <p className="field__label"><Trans>Partner Logo</Trans></p>
                  <p className="field__help">
                    <Trans>Automatic discovery is preferred. You can still paste a direct URL or upload a file manually.</Trans>
                  </p>
                </div>
                <Badge>{getLogoStatusLabel(mergedBranding.logoFetchStatus)}</Badge>
              </div>

              {effectiveLogoPreview ? (
                <div className="dash-preview">
                  <img src={effectiveLogoPreview} alt={t`Logo preview`} className="max-h-16 w-auto object-contain" />
                  <IconButton label={t`Remove logo`} onClick={clearManualLogo} className="dash-preview__remove">
                    <X className="icon" aria-hidden="true" />
                  </IconButton>
                </div>
              ) : (
                <div className="dash-preview">
                  <Trans>No logo selected yet</Trans>
                </div>
              )}

              <div className="dash-subfield__row">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleRequestLogoDiscovery}
                  disabled={!canTriggerDiscovery || requestingLogoDiscovery}
                  isLoading={requestingLogoDiscovery}
                >
                  <Search className="icon" aria-hidden="true" />
                  <Trans>Find Logo Automatically</Trans>
                </Button>
                {!initialData && (
                  <span className="field__help">
                    <Trans>Creating the room will automatically start background discovery when no logo is set yet.</Trans>
                  </span>
                )}
              </div>

              <Input
                label={t`Logo URL`}
                placeholder="https://example.com/logo.png"
                value={mergedBranding.logoUrl || ''}
                onChange={e => setManualLogoUrl(e.target.value)}
                error={validationErrors.logo}
              />

              <div className="dash-subfield__row">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={uploadingLogo}
                  className="relative"
                >
                  {uploadingLogo ? (
                    <>
                      <span className="spin" aria-hidden="true" />
                      <Trans>Uploading...</Trans>
                    </>
                  ) : (
                    <>
                      <ImageIcon className="icon" aria-hidden="true" />
                      <Trans>Upload Logo</Trans>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoFileUpload}
                    className="dash-upload__input"
                    disabled={uploadingLogo}
                  />
                </Button>
                <span className="field__help"><Trans>Manual fallback if automatic discovery fails</Trans></span>
              </div>

              {mergedBranding.logoFetchError && (
                <p className="field__help field__help--error">
                  {mergedBranding.logoFetchError}
                </p>
              )}
            </div>

            <div className="dash-subfield">
              <p className="field__label"><Trans>Background Image</Trans></p>

              {effectiveBackgroundPreview && (
                <div className="dash-preview dash-preview--image">
                  <img
                    src={effectiveBackgroundPreview}
                    alt={t`Background preview`}
                    className="h-full w-full object-cover"
                  />
                  <IconButton
                    label={t`Remove background`}
                    onClick={() => {
                      setBranding(current => ({
                        ...current,
                        backgroundImageUrl: '',
                        backgroundStorageId: undefined,
                      }));
                      setBackgroundPreview(null);
                    }}
                    className="dash-preview__remove"
                  >
                    <X className="icon" aria-hidden="true" />
                  </IconButton>
                </div>
              )}

              <div className="dash-subfield__row">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={uploadingBackground}
                  className="relative"
                >
                  {uploadingBackground ? (
                    <>
                      <span className="spin" aria-hidden="true" />
                      <Trans>Uploading...</Trans>
                    </>
                  ) : (
                    <>
                      <ImageIcon className="icon" aria-hidden="true" />
                      <Trans>Upload Image</Trans>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleBackgroundFileUpload}
                    className="dash-upload__input"
                    disabled={uploadingBackground}
                  />
                </Button>

                <span className="field__help"><Trans>or enter URL below</Trans></span>
              </div>

              <Input
                aria-label={t`Background Image`}
                placeholder="https://example.com/background.jpg"
                value={mergedBranding.backgroundImageUrl || ''}
                onChange={e => {
                  updateBrandingField('backgroundImageUrl', e.target.value);
                  setBackgroundPreview(e.target.value);
                }}
                helperText={t`Upload an image (max 5MB) or paste an image URL`}
              />
              {validationErrors.background && (
                <p role="alert" className="field__help field__help--error">
                  {validationErrors.background}
                </p>
              )}
            </div>
          </section>
        </form>
      </div>

      <div className="panel__foot">
        <Button type="button" variant="secondary" onClick={onClose}><Trans>Cancel</Trans></Button>
        <Button type="submit" form="room-form">
          {initialData ? <Trans>Save Changes</Trans> : <Trans>Create Room</Trans>}
        </Button>
      </div>
    </Modal>
  );
};
