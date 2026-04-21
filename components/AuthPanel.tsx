import React, { useCallback, useEffect, useState } from 'react';
import {
  Crown,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Mail,
  ShieldCheck,
  UserPlus,
  UserRound,
} from 'lucide-react';
import {
  AuthSessionPayload,
  changeCurrentUserPassword,
  fetchCurrentAuthSession,
  fetchRegistrationStatus,
  loginWithEmailCode,
  loginWithPassword,
  logoutAuthSession,
  registerWithPassword,
  RegistrationStatusPayload,
  requestEmailCode,
  requestPasswordResetCode,
  resetPasswordWithEmailCode,
  setCurrentUserPassword,
} from '../src/services/accountIdentity';
import { useToast } from '../src/context/ToastContext';

interface AuthPanelProps {
  session: AuthSessionPayload | null;
  onSessionChange: (session: AuthSessionPayload | null) => void;
}

type AuthMode = 'login' | 'register' | 'code' | 'forgot';

const AuthPanel: React.FC<AuthPanelProps> = ({ session, onSessionChange }) => {
  const toast = useToast();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [code, setCode] = useState('');
  const [requestingCode, setRequestingCode] = useState(false);
  const [passwordSetup, setPasswordSetup] = useState('');
  const [passwordSetupConfirm, setPasswordSetupConfirm] = useState('');
  const [changeCurrentPassword, setChangeCurrentPassword] = useState('');
  const [changeNewPassword, setChangeNewPassword] = useState('');
  const [changeNewPasswordConfirm, setChangeNewPasswordConfirm] = useState('');
  const [showPasswordPanel, setShowPasswordPanel] = useState(false);
  const [forgotCode, setForgotCode] = useState('');
  const [forgotPassword, setForgotPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [registrationStatus, setRegistrationStatus] = useState<RegistrationStatusPayload | null>(null);

  const refreshSession = useCallback(async () => {
    setLoading(true);
    try {
      const [current, nextStatus] = await Promise.all([
        fetchCurrentAuthSession(),
        fetchRegistrationStatus().catch(() => null),
      ]);
      onSessionChange(current);
      setRegistrationStatus(nextStatus);
      if (current?.user?.email) {
        setEmail(current.user.email);
        setDisplayName(current.user.displayName || '');
      }
    } finally {
      setLoading(false);
    }
  }, [onSessionChange]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (!session?.authenticated) {
      setShowPasswordPanel(false);
      setPasswordSetup('');
      setPasswordSetupConfirm('');
      setChangeCurrentPassword('');
      setChangeNewPassword('');
      setChangeNewPasswordConfirm('');
    }
  }, [session?.authenticated]);

  useEffect(() => {
    if (session?.authenticated) {
      setShowPasswordPanel(false);
    }
  }, [session?.user?.passwordConfigured, session?.user?.userId, session?.authenticated]);

  const resetLoggedOutFields = () => {
    setPassword('');
    setConfirmPassword('');
    setCode('');
    setForgotCode('');
    setForgotPassword('');
    setForgotConfirmPassword('');
    setHint(null);
  };

  const updateLoggedInSession = (user: AuthSessionPayload['user']) => {
    onSessionChange({
      success: true,
      authenticated: true,
      user,
    });
  };

  const handleRegister = async () => {
    if (!email.trim()) {
      setHint('请输入邮箱地址');
      return;
    }
    if (!password.trim()) {
      setHint('请输入密码');
      return;
    }
    if (password !== confirmPassword) {
      setHint('两次输入的密码不一致');
      return;
    }

    setSubmitting(true);
    setHint(null);
    try {
      const nextSession = await registerWithPassword({
        email: email.trim(),
        password,
        displayName: displayName.trim(),
      });
      onSessionChange(nextSession);
      setRegistrationStatus((prev) =>
        prev
          ? {
              ...prev,
              totalUsers: prev.totalUsers + 1,
              hasUsers: true,
              firstUserWillBeSuperAdmin: false,
            }
          : prev,
      );
      resetLoggedOutFields();
      toast.success(
        nextSession.createdSuperAdmin
          ? '注册成功，你已成为超级管理员'
          : '注册成功，已自动登录',
      );
    } catch (error) {
      setHint((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setHint('请输入邮箱和密码');
      return;
    }

    setSubmitting(true);
    setHint(null);
    try {
      const nextSession = await loginWithPassword({
        email: email.trim(),
        password,
      });
      onSessionChange(nextSession);
      resetLoggedOutFields();
      toast.success('登录成功');
    } catch (error) {
      setHint((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestCode = async () => {
    if (!email.trim()) {
      setHint('请输入邮箱地址');
      return;
    }

    setRequestingCode(true);
    setHint(null);
    try {
      const result = await requestEmailCode(email.trim());
      toast.success('验证码已发送，请检查邮箱');
      if (result.previewCode) {
        toast.info(`开发模式验证码：${result.previewCode}`);
      }
    } catch (error) {
      setHint((error as Error).message);
    } finally {
      setRequestingCode(false);
    }
  };

  const handleCodeLogin = async () => {
    if (!email.trim() || !code.trim()) {
      setHint('请输入邮箱和验证码');
      return;
    }

    setSubmitting(true);
    setHint(null);
    try {
      const nextSession = await loginWithEmailCode(email.trim(), code.trim());
      onSessionChange(nextSession);
      setCode('');
      toast.success('验证码登录成功');
    } catch (error) {
      setHint((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotRequestCode = async () => {
    if (!email.trim()) {
      setHint('请输入邮箱地址');
      return;
    }

    setRequestingCode(true);
    setHint(null);
    try {
      const result = await requestPasswordResetCode(email.trim());
      toast.success('重置验证码已发送，请检查邮箱');
      if (result.previewCode) {
        toast.info(`开发模式验证码：${result.previewCode}`);
      }
    } catch (error) {
      setHint((error as Error).message);
    } finally {
      setRequestingCode(false);
    }
  };

  const handleForgotReset = async () => {
    if (!email.trim() || !forgotCode.trim()) {
      setHint('请输入邮箱和验证码');
      return;
    }
    if (!forgotPassword.trim()) {
      setHint('请输入新密码');
      return;
    }
    if (forgotPassword !== forgotConfirmPassword) {
      setHint('两次输入的新密码不一致');
      return;
    }

    setSubmitting(true);
    setHint(null);
    try {
      const nextSession = await resetPasswordWithEmailCode({
        email: email.trim(),
        code: forgotCode.trim(),
        password: forgotPassword,
      });
      onSessionChange(nextSession);
      resetLoggedOutFields();
      toast.success('密码已重置，并已自动登录');
    } catch (error) {
      setHint((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetPassword = async () => {
    if (!passwordSetup.trim()) {
      setHint('请输入新密码');
      return;
    }
    if (passwordSetup !== passwordSetupConfirm) {
      setHint('两次输入的新密码不一致');
      return;
    }

    setSubmitting(true);
    setHint(null);
    try {
      const nextUser = await setCurrentUserPassword(passwordSetup);
      updateLoggedInSession(nextUser);
      setPasswordSetup('');
      setPasswordSetupConfirm('');
      setShowPasswordPanel(false);
      toast.success('密码设置成功，以后可以直接用密码登录');
    } catch (error) {
      setHint((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleChangePassword = async () => {
    if (!changeCurrentPassword.trim()) {
      setHint('请输入当前密码');
      return;
    }
    if (!changeNewPassword.trim()) {
      setHint('请输入新密码');
      return;
    }
    if (changeNewPassword !== changeNewPasswordConfirm) {
      setHint('两次输入的新密码不一致');
      return;
    }

    setSubmitting(true);
    setHint(null);
    try {
      const nextUser = await changeCurrentUserPassword({
        currentPassword: changeCurrentPassword,
        newPassword: changeNewPassword,
      });
      updateLoggedInSession(nextUser);
      setChangeCurrentPassword('');
      setChangeNewPassword('');
      setChangeNewPasswordConfirm('');
      setShowPasswordPanel(false);
      toast.success('密码修改成功');
    } catch (error) {
      setHint((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setSubmitting(true);
    try {
      await logoutAuthSession();
      onSessionChange(null);
      setPassword('');
      setConfirmPassword('');
      toast.info('你已退出登录');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 rounded-3xl border border-sky-400/20 bg-linear-to-br from-sky-500/10 via-sky-500/5 to-transparent p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-sky-100">
            <Lock size={16} />
            账户登录
          </div>
          <p className="mt-1 text-xs leading-5 text-sky-100/70">
            支持邮箱 + 密码登录，也支持验证码迁移和忘记密码后的邮箱重置。
          </p>
        </div>
        {loading && <Loader2 size={16} className="animate-spin text-sky-200" />}
      </div>

      {hint && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {hint}
        </div>
      )}

      {session?.authenticated ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
                  <UserRound size={15} />
                  <span className="truncate">{session.user.displayName || session.user.email}</span>
                  {session.user.isSuperAdmin ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-[10px] font-medium text-yellow-200">
                      <Crown size={10} />
                      超级管理员
                    </span>
                  ) : session.user.isAdmin ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
                      <ShieldCheck size={10} />
                      管理员
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-gray-400">{session.user.email}</div>
                <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] text-gray-400 md:grid-cols-3">
                  <div>用户 ID：{session.user.userId}</div>
                  <div>角色：{session.user.role}</div>
                  <div>
                    最近登录：
                    {' '}
                    {session.user.lastLoginAt
                      ? new Date(session.user.lastLoginAt).toLocaleString()
                      : '首次登录'}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setShowPasswordPanel((current) => !current)}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-sky-500/20 bg-sky-500/10 px-4 text-xs text-sky-100 hover:bg-sky-500/15"
                >
                  <KeyRound size={13} />
                  {showPasswordPanel
                    ? session.user.passwordConfigured
                      ? '收起修改密码'
                      : '收起设置密码'
                    : session.user.passwordConfigured
                      ? '修改密码'
                      : '设置密码'}
                </button>

                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  disabled={submitting}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-xs text-gray-200 hover:bg-white/10 disabled:opacity-60"
                >
                  {submitting ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />}
                  退出登录
                </button>
              </div>
            </div>
          </div>

          {showPasswordPanel &&
            (!session.user.passwordConfigured ? (
              <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-4">
                <div className="mb-3 text-sm font-semibold text-yellow-100">为当前账号设置密码</div>
                <p className="mb-3 text-xs leading-5 text-yellow-100/80">
                  这个账号还没有密码。设置完成后，以后可以直接用邮箱和密码登录，不需要再走验证码。
                </p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <input
                    type="password"
                    value={passwordSetup}
                    onChange={(event) => setPasswordSetup(event.target.value)}
                    placeholder="输入新密码"
                    className="h-10 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
                  />
                  <input
                    type="password"
                    value={passwordSetupConfirm}
                    onChange={(event) => setPasswordSetupConfirm(event.target.value)}
                    placeholder="再次输入新密码"
                    className="h-10 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleSetPassword()}
                  disabled={submitting}
                  className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-yellow-500 px-4 text-sm font-medium text-black transition-colors hover:bg-yellow-400 disabled:opacity-60"
                >
                  {submitting ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                  立即设置密码
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="mb-3 text-sm font-semibold text-white">修改密码</div>
                <p className="mb-3 text-xs leading-5 text-gray-400">
                  输入当前密码后即可修改。修改成功后，现有登录状态仍会保留。
                </p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <input
                    type="password"
                    value={changeCurrentPassword}
                    onChange={(event) => setChangeCurrentPassword(event.target.value)}
                    placeholder="当前密码"
                    className="h-10 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
                  />
                  <input
                    type="password"
                    value={changeNewPassword}
                    onChange={(event) => setChangeNewPassword(event.target.value)}
                    placeholder="新密码"
                    className="h-10 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
                  />
                  <input
                    type="password"
                    value={changeNewPasswordConfirm}
                    onChange={(event) => setChangeNewPasswordConfirm(event.target.value)}
                    placeholder="确认新密码"
                    className="h-10 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleChangePassword()}
                  disabled={submitting}
                  className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-60"
                >
                  {submitting ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                  修改密码
                </button>
              </div>
            ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/20 p-1 md:grid-cols-4">
            {[
              ['login', '密码登录'],
              ['register', '注册账户'],
              ['code', '验证码迁移'],
              ['forgot', '忘记密码'],
            ].map(([modeValue, label]) => (
              <button
                key={modeValue}
                type="button"
                onClick={() => {
                  setMode(modeValue as AuthMode);
                  setHint(null);
                }}
                className={`rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
                  mode === modeValue ? 'bg-white text-black' : 'text-gray-300 hover:bg-white/5'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {registrationStatus?.firstUserWillBeSuperAdmin && mode === 'register' && (
            <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/10 px-3 py-3 text-xs leading-5 text-yellow-100">
              当前系统还没有任何账户，第一个完成注册的用户会自动成为超级管理员。
            </div>
          )}

          {mode === 'register' && (
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-gray-400">
                显示名称
              </label>
              <div className="relative">
                <UserPlus
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                />
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="例如：运营后台管理员"
                  className="h-11 w-full rounded-2xl border border-white/10 bg-black/20 pl-10 pr-4 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-gray-400">
              邮箱地址
            </label>
            <div className="relative">
              <Mail
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
              />
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="输入邮箱地址"
                className="h-11 w-full rounded-2xl border border-white/10 bg-black/20 pl-10 pr-4 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
            </div>
          </div>

          {(mode === 'login' || mode === 'register') && (
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-gray-400">
                密码
              </label>
              <div className="relative">
                <Lock
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="至少 8 位密码"
                  className="h-11 w-full rounded-2xl border border-white/10 bg-black/20 pl-10 pr-11 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                  title={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          )}

          {mode === 'register' && (
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-gray-400">
                确认密码
              </label>
              <div className="relative">
                <Lock
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                />
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="再次输入密码"
                  className="h-11 w-full rounded-2xl border border-white/10 bg-black/20 pl-10 pr-11 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                  title={showConfirmPassword ? '隐藏密码' : '显示密码'}
                >
                  {showConfirmPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          )}

          {mode === 'code' && (
            <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs leading-5 text-gray-400">
                用于老账号迁移或临时登录。登录成功后，建议立即为当前账号设置密码。
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="输入 6 位验证码"
                  className="h-11 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleRequestCode()}
                  disabled={requestingCode}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-white hover:bg-white/10 disabled:opacity-60"
                >
                  {requestingCode ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                  发送验证码
                </button>
              </div>
            </div>
          )}

          {mode === 'forgot' && (
            <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs leading-5 text-gray-400">
                输入邮箱后发送重置验证码，通过验证后即可直接设置新密码。
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
                <input
                  value={forgotCode}
                  onChange={(event) => setForgotCode(event.target.value)}
                  placeholder="输入 6 位重置验证码"
                  className="h-11 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleForgotRequestCode()}
                  disabled={requestingCode}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-white hover:bg-white/10 disabled:opacity-60"
                >
                  {requestingCode ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                  发送重置码
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <input
                  type="password"
                  value={forgotPassword}
                  onChange={(event) => setForgotPassword(event.target.value)}
                  placeholder="输入新密码"
                  className="h-11 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
                />
                <input
                  type="password"
                  value={forgotConfirmPassword}
                  onChange={(event) => setForgotConfirmPassword(event.target.value)}
                  placeholder="再次输入新密码"
                  className="h-11 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-gray-400">
            <div>
              {mode === 'login'
                ? '密码登录后会自动保持会话，不需要每次再收验证码。'
                : mode === 'register'
                  ? '注册成功后会自动登录，并立即绑定点数账户。'
                  : mode === 'code'
                    ? '验证码迁移适合老账号临时进入后补设密码。'
                    : '忘记密码时可通过邮箱验证码安全重置。'}
            </div>
            <button
              type="button"
              onClick={() =>
                void (mode === 'login'
                  ? handleLogin()
                  : mode === 'register'
                    ? handleRegister()
                    : mode === 'code'
                      ? handleCodeLogin()
                      : handleForgotReset())
              }
              disabled={submitting}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : mode === 'login' ? (
                <Lock size={14} />
              ) : mode === 'register' ? (
                <UserPlus size={14} />
              ) : (
                <KeyRound size={14} />
              )}
              {mode === 'login'
                ? '立即登录'
                : mode === 'register'
                  ? '创建账户'
                  : mode === 'code'
                    ? '验证码登录'
                    : '重置密码'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuthPanel;
