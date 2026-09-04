import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Camera, KeyRound, Save, ShieldCheck } from 'lucide-react';
import { Panel, Stat } from '../components/UI/Panel.jsx';
import { Button } from '../components/UI/Button.jsx';
import { Input } from '../components/UI/Field.jsx';
import { Avatar } from '../components/UI/Avatar.jsx';
import { Loading, ErrorState } from '../components/UI/States.jsx';
import { useApi } from '../hooks/useApi.js';
import { authApi } from '../services/authApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatMoney, formatDate } from '../utils/format.js';

const PROVIDER_LABEL = {
  email: 'Email and password',
  google: 'Google',
  'email+google': 'Email and Google',
};

export function Profile() {
  const { updateUser } = useAuth();
  const toast = useToast();
  const profile = useApi(() => authApi.profile(), []);
  const [savingName, setSavingName] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const pickPhoto = useRef(null);
  const [savingPhoto, setSavingPhoto] = useState(false);

  const nameForm = useForm({ values: { name: profile.data?.user?.name ?? '' } });
  const passwordForm = useForm({ defaultValues: { currentPassword: '', newPassword: '' } });

  if (profile.loading) return <Loading label="Loading profile…" className="min-h-[60vh]" />;
  if (profile.error) return <ErrorState error={profile.error} onRetry={profile.reload} className="min-h-[60vh]" />;

  const { user, stats } = profile.data;
  const currency = stats.fulfilledByCurrency?.[0]?.currency ?? 'INR';

  const saveName = async (values) => {
    setSavingName(true);
    try {
      const result = await authApi.updateProfile({ name: values.name.trim() });
      updateUser(result.user);
      toast.success('Profile updated');
      profile.refresh();
    } catch (error) {
      toast.error('That could not be saved', error.message);
    } finally {
      setSavingName(false);
    }
  };

  const savePassword = async (values) => {
    setSavingPassword(true);
    try {
      await authApi.changePassword({
        currentPassword: values.currentPassword || undefined,
        newPassword: values.newPassword,
      });
      toast.success('Password updated', user.hasPassword ? 'Use it next time you sign in.' : 'You can now sign in with email too.');
      passwordForm.reset({ currentPassword: '', newPassword: '' });
      profile.refresh();
    } catch (error) {
      toast.error('That password could not be set', error.message);
    } finally {
      setSavingPassword(false);
    }
  };

  /** Changing the portrait. */

  const changePhoto = async (event) => {
    const file = event.target.files?.[0];
    // Chosen, then cancelled — nothing to do.
    if (!file) return;
    setSavingPhoto(true);
    try {
      const result = await authApi.uploadAvatar(file);
      updateUser(result.user);
      profile.refresh();
      toast.success('Profile picture updated');
    } catch (error) {
      toast.error('That picture could not be saved', error.message);
    } finally {
      setSavingPhoto(false);
      // Cleared so choosing the same file again still fires a change.
      event.target.value = '';
    }
  };

  const clearPhoto = async () => {
    setSavingPhoto(true);
    try {
      const result = await authApi.removeAvatar();
      updateUser(result.user);
      profile.refresh();
      toast.success('Profile picture removed', 'Your initials are shown instead.');
    } catch (error) {
      toast.error('That picture could not be removed', error.message);
    } finally {
      setSavingPhoto(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-center gap-5 border-b border-ink-300/60 pb-6">
        <div className="relative shrink-0">
          <Avatar user={user} size={64} />
          <button
            type="button"
            onClick={() => pickPhoto.current?.click()}
            disabled={savingPhoto}
            aria-label="Change your profile picture"
            className="absolute inset-0 flex items-center justify-center rounded-full bg-scrim/70
                       text-paper-50 opacity-0 transition-opacity hover:opacity-100
                       focus-visible:opacity-100 disabled:cursor-not-allowed"
          >
            <Camera size={18} strokeWidth={1.6} />
          </button>
          <input
            ref={pickPhoto}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={changePhoto}
            className="hidden"
          />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-[26px] leading-tight text-paper-50">{user.name}</h1>
          <p className="mt-1 text-[13px] text-paper-300">{user.email}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 label text-paper-400">
            <span className="flex items-center gap-1.5">
              <ShieldCheck size={11} strokeWidth={1.75} />
              {PROVIDER_LABEL[user.authProvider] ?? user.authProvider}
            </span>
            <span aria-hidden>·</span>
            <span>Joined {formatDate(user.createdAt)}</span>
            {user.lastLoginAt ? (
              <>
                <span aria-hidden>·</span>
                <span>Last signed in {formatDate(user.lastLoginAt, { withTime: true })}</span>
              </>
            ) : null}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              icon={Camera}
              loading={savingPhoto}
              onClick={() => pickPhoto.current?.click()}
            >
              {user.avatar ? 'Change photo' : 'Add a photo'}
            </Button>
            {user.avatar ? (
              <Button variant="quiet" size="sm" onClick={clearPhoto} disabled={savingPhoto}>
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-4">
        <Stat label="Promises" value={stats.totalPromises} sub="All you can see" />
        <Stat label="Active" value={stats.activePromises} sub="Money conditional" tone="brass" />
        <Stat label="Fulfilled" value={stats.fulfilledPromises} sub="Proven and paid" tone="sage" />
        <Stat
          label="Fulfilled value"
          value={formatMoney(stats.fulfilledValue, currency, { compact: true })}
          sub={`${stats.chronicleEntries} Chronicle entries`}
        />
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Panel label="Account" title="Your details">
          <form onSubmit={nameForm.handleSubmit(saveName)} className="space-y-4">
            <Input label="Name" {...nameForm.register('name', { required: true, minLength: 2 })} />
            <Input label="Email" value={user.email} disabled readOnly hint="Cannot be changed" />
            <Button type="submit" variant="ghost" icon={Save} loading={savingName}>
              Save
            </Button>
          </form>
        </Panel>

        <Panel label="Security" title={user.hasPassword ? 'Change your password' : 'Add a password'}>
          <form onSubmit={passwordForm.handleSubmit(savePassword)} className="space-y-4">
            {user.hasPassword ? (
              <Input
                label="Current password"
                type="password"
                autoComplete="current-password"
                {...passwordForm.register('currentPassword')}
              />
            ) : (
              <p className="text-[12.5px] leading-relaxed text-paper-300">
                You signed in with Google. Adding a password lets you sign in either way — both routes reach the same
                account.
              </p>
            )}
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              hint="8+ characters, a letter and a number"
              {...passwordForm.register('newPassword', { required: true, minLength: 8 })}
            />
            <Button type="submit" variant="ghost" icon={KeyRound} loading={savingPassword}>
              {user.hasPassword ? 'Update password' : 'Set password'}
            </Button>
          </form>
        </Panel>
      </div>
    </div>
  );
}
