import { useConnectionSlice, useProfileSlice } from '../../context/CollabContext'
import { ProfilePage } from '../ProfilePage'

type Props = {
  workspace: string
  inviteLink: string
  onBack: () => void
}

export function ProfilePanel({ workspace, inviteLink, onBack }: Props) {
  const { relayOnline, connectionStatus, rtcPeerCount } = useConnectionSlice()
  const { selfId, profile, updateProfile, setAvatar, clearAvatar } = useProfileSlice()

  return (
    <ProfilePage
      profile={profile}
      workspace={workspace}
      selfId={selfId}
      relayOnline={relayOnline}
      connectionStatus={connectionStatus}
      rtcPeerCount={rtcPeerCount}
      inviteLink={inviteLink}
      onNameChange={name => updateProfile({ name })}
      onColorChange={color => updateProfile({ color })}
      onAvatarChange={setAvatar}
      onAvatarClear={() => void clearAvatar()}
      onBack={onBack}
    />
  )
}