// src/components/jiff/JiffHeader.jsx — v1.23.00
// Header: [jiff wordmark] ... [🔔 bell] [👤 avatar ▼]
// Wordmark only — no icon. Consistent with v1.23.00 brand reset.

import JiffLogo from '../JiffLogo';

export default function JiffHeader({
  view, user, profile, isPremium, trialActive, trialDaysLeft,
  showNotifications, setShowNotifications, notifications, unreadCount,
  showUserMenu, setShowUserMenu,
  markAllRead, signOut, navigate, t,
}) {
  const menuItems = [
    { label:'⚙️ Your Preferences', action:() => navigate('/profile')  },
    { label:'📊 Insights',          action:() => navigate('/insights') },
    { label:'📜 History',           action:() => navigate('/history')  },
    ...(!isPremium ? [{ label:'⚡ Upgrade to Premium', action:() => navigate('/pricing'), highlight:true }] : []),
  ];

  return (
    <header className="header">
      {/* Wordmark — no icon */}
      <JiffLogo
        size="md"
        onClick={() => navigate('/app')}
        style={{ flexShrink:0 }}
      />

      <div className="header-right">
        {user && (
          <div style={{ position:'relative' }}>
            <button onClick={() => setShowUserMenu(p => !p)} aria-label="Profile menu"
              style={{ display:'flex', alignItems:'center', gap:7, padding:'5px 10px', borderRadius:20, border:'1.5px solid rgba(28,10,0,0.18)', background:'white', cursor:'pointer', fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:500, color:'#1C0A00', transition:'all 0.15s', touchAction:'manipulation' }}>
              <span style={{ width:26, height:26, borderRadius:'50%', background:'#FF4500', color:'white', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, flexShrink:0, lineHeight:1 }}>
                {(profile?.name || 'U').charAt(0).toUpperCase()}
              </span>
              <span style={{ maxWidth:72, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {profile?.name?.split(' ')[0] || t('profile_nav')}
              </span>
              <span style={{ fontSize:9, color:'#7C6A5E', flexShrink:0 }}>{'▼'}</span>
            </button>

            {showUserMenu && (
              <div onClick={() => setShowUserMenu(false)} style={{ position:'fixed', inset:0, zIndex:99 }} aria-hidden="true"/>
            )}
            {showUserMenu && (
              <div style={{ position:'absolute', right:0, top:'calc(100% + 6px)', background:'white', border:'1px solid rgba(28,10,0,0.12)', borderRadius:12, boxShadow:'0 8px 24px rgba(28,10,0,0.12)', minWidth:196, zIndex:100, overflow:'hidden', fontFamily:"'DM Sans',sans-serif" }}>
                <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(28,10,0,0.07)', fontSize:11, color:'#7C6A5E', fontWeight:300, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {user.email}
                </div>
                {menuItems.map(item => (
                  <button key={item.label}
                    onClick={() => { item.action(); setShowUserMenu(false); }}
                    style={{ width:'100%', padding:'10px 14px', border:'none', background:item.highlight?'rgba(255,69,0,0.04)':'white', cursor:'pointer', textAlign:'left', fontSize:13, color:item.highlight?'#FF4500':'#1C0A00', fontWeight:item.highlight?600:400, fontFamily:"'DM Sans',sans-serif", borderBottom:'1px solid rgba(28,10,0,0.05)', transition:'background 0.1s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = item.highlight?'rgba(255,69,0,0.08)':'rgba(255,69,0,0.04)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = item.highlight?'rgba(255,69,0,0.04)':'white'; }}>
                    {item.label}
                  </button>
                ))}
                <button onClick={() => { signOut(); setShowUserMenu(false); navigate('/'); }}
                  style={{ width:'100%', padding:'10px 14px', border:'none', background:'white', cursor:'pointer', textAlign:'left', fontSize:13, color:'#E53E3E', fontWeight:500, fontFamily:"'DM Sans',sans-serif", transition:'background 0.1s' }}
                  onMouseEnter={e => { e.currentTarget.style.background='rgba(229,62,62,0.05)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background='white'; }}>
                  {'🚪 Sign out'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
