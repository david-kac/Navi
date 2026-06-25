import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { Plus } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import AddFriendModal from './AddFriendModal';

const INK    = '#2D2D2D';
const BG     = '#FEFEFE';
const MUTED  = '#8A8480';
const BORDER = 1.354;
const MARGIN = 18;
const SPRITE = 40;
const DRAWER_BG   = '#F8F8F8';
const DRAWER_LINE = '#CCCCCC';
const ROW_LINE    = '#DDDDDD';

const GREAT_IMG = require('../assets/Great.png');
const GOOD_IMG  = require('../assets/Good.png');
const REACH_IMG = require('../assets/Reach out.png');

const POINTS: Record<string, number> = { VISIT: 90, CALL: 75, MSG: 25 };

interface Friend     { id: string; name: string; created_at: string }
interface ContactLog { id: string; friend_id: string; contact_date: string; type: 'VISIT' | 'CALL' | 'MSG' }

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function cutoffDate(daysBack: number): Date {
  const d = new Date(); d.setDate(d.getDate() - daysBack); d.setHours(0,0,0,0); return d;
}

function calcHP(logs: ContactLog[]): number {
  const cutoff = cutoffDate(30);
  return Math.min(100,
    logs
      .filter(l => new Date(l.contact_date + 'T00:00:00') >= cutoff)
      .reduce((sum, l) => sum + (POINTS[l.type] ?? 0), 0)
  );
}

function getSprite(hp: number) {
  if (hp >= 75) return GREAT_IMG;
  if (hp >= 25) return GOOD_IMG;
  return REACH_IMG;
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00')
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    .toUpperCase();
}

function fmtMonth(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00')
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    .toUpperCase();
}

function getLast30(logs: ContactLog[]): ContactLog[] {
  const cutoff = cutoffDate(30);
  return logs
    .filter(l => new Date(l.contact_date + 'T00:00:00') >= cutoff)
    .sort((a, b) => b.contact_date.localeCompare(a.contact_date));
}

function getPast6Months(logs: ContactLog[]): { label: string; logs: ContactLog[] }[] {
  const from = cutoffDate(180);
  const to   = cutoffDate(30);
  const older = logs.filter(l => {
    const d = new Date(l.contact_date + 'T00:00:00');
    return d >= from && d < to;
  }).sort((a, b) => b.contact_date.localeCompare(a.contact_date));

  const map = new Map<string, ContactLog[]>();
  for (const l of older) {
    const key = fmtMonth(l.contact_date);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(l);
  }
  return Array.from(map.entries()).map(([label, logs]) => ({ label, logs }));
}

// ─── Dashed line — segment-based, works on iOS (borderStyle:'dashed' with
//     directional borders is broken on iOS in RN) ────────────────────────────
function DashedLine({ color = DRAWER_LINE }: { color?: string }) {
  return (
    <View style={{ flexDirection: 'row', overflow: 'hidden' }}>
      {Array.from({ length: 80 }).map((_, i) => (
        <View key={i} style={{ width: 6, height: 1, backgroundColor: color, marginRight: 4 }} />
      ))}
    </View>
  );
}

// ─── HP bar — bordered track from Figma ──────────────────────────────────────
function HPBar({ value }: { value: number }) {
  return (
    <View style={s.hpRow}>
      <Text style={s.hpLabel}>HP:</Text>
      <View style={s.hpTrack}>
        <View style={[s.hpFill, { width: `${value}%` as any }]} />
      </View>
    </View>
  );
}

// ─── Type badge — MUTED border + text from Figma ─────────────────────────────
function TypeBadge({ type }: { type: string }) {
  return (
    <View style={s.badge}>
      <Text style={s.badgeTxt}>{type}</Text>
    </View>
  );
}

// ─── Contact log row — solid #DDD bottom separator from Figma ────────────────
function LogRow({ log, onLongPress }: { log: ContactLog; onLongPress?: () => void }) {
  return (
    <TouchableOpacity
      style={s.logRow}
      onLongPress={onLongPress}
      delayLongPress={400}
      activeOpacity={onLongPress ? 0.6 : 1}
    >
      <Text style={s.logDate}>{fmtDate(log.contact_date)}</Text>
      <TypeBadge type={log.type} />
    </TouchableOpacity>
  );
}

// ─── Friend card ─────────────────────────────────────────────────────────────
interface FriendCardProps {
  friend:     Friend;
  logs:       ContactLog[];
  userId:     string;
  onLogAdded: () => void;
  onRemove:   (id: string) => void;
}

function FriendCard({ friend, logs, userId, onLogAdded, onRemove }: FriendCardProps) {
  const [expanded,  setExpanded]  = useState(false);
  const [showPast6, setShowPast6] = useState(false);
  const [logging,   setLogging]   = useState(false);

  const hp     = calcHP(logs);
  const last30 = getLast30(logs);
  const past6  = getPast6Months(logs);

  const logContact = async (type: 'VISIT' | 'CALL' | 'MSG') => {
    setLogging(true);
    const { error } = await supabase.from('contact_logs').insert({
      user_id: userId, friend_id: friend.id, contact_date: toISODate(new Date()), type,
    });
    if (error) Alert.alert('Error', error.message);
    else onLogAdded(); // silent refresh — drawer stays open
    setLogging(false);
  };

  const promptLog = () => {
    Alert.alert(`Log contact — ${friend.name}`, 'What kind of contact?', [
      { text: 'VISIT', onPress: () => logContact('VISIT') },
      { text: 'CALL',  onPress: () => logContact('CALL')  },
      { text: 'MSG',   onPress: () => logContact('MSG')   },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const confirmRemove = () => {
    Alert.alert(`Remove ${friend.name}?`, 'This will delete all contact history too.', [
      { text: 'Remove', style: 'destructive', onPress: () => onRemove(friend.id) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleLogAction = (log: ContactLog) => {
    const ALL_TYPES: Array<'VISIT' | 'CALL' | 'MSG'> = ['VISIT', 'CALL', 'MSG'];
    const otherTypes = ALL_TYPES.filter(t => t !== log.type);
    Alert.alert(
      fmtDate(log.contact_date),
      `Logged as ${log.type}`,
      [
        ...otherTypes.map(t => ({
          text: `Change to ${t}`,
          onPress: async () => {
            await supabase.from('contact_logs').update({ type: t }).eq('id', log.id);
            onLogAdded();
          },
        })),
        {
          text: 'Delete log',
          style: 'destructive' as const,
          onPress: async () => {
            await supabase.from('contact_logs').delete().eq('id', log.id);
            onLogAdded();
          },
        },
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  };

  return (
    <View>
      {/* ── Header row ── */}
      <TouchableOpacity style={s.cardHeader} onPress={() => setExpanded(v => !v)} activeOpacity={0.85}>
        <Image source={getSprite(hp)} style={s.sprite} resizeMode="contain" />
        <View style={s.cardInfo}>
          <View style={s.cardTopRow}>
            <Text style={s.friendName}>{friend.name}</Text>
            <Text style={s.hpValue}>{hp}/100</Text>
          </View>
          <HPBar value={hp} />
        </View>
      </TouchableOpacity>

      {/* ── Expanded drawer — #FCFCFC bg, dashed top + bottom ── */}
      {expanded && (
        <View style={s.drawer}>
          <DashedLine />
          <View style={s.drawerInner}>
          <Text style={s.sectionLabel}>LAST 30 DAYS</Text>

          {/* Half the previous gap between label and first row */}
          <View style={{ paddingTop: 7 }}>
            {last30.length === 0
              ? <Text style={s.emptyTxt}>No contacts in the last 30 days.</Text>
              : last30.map(l => <LogRow key={l.id} log={l} onLongPress={() => handleLogAction(l)} />)}
          </View>

          <TouchableOpacity style={s.past6Btn} onPress={() => setShowPast6(v => !v)} activeOpacity={0.7}>
            <Text style={s.past6Txt}>{showPast6 ? '▲' : '▼'} SEE PAST 6 MONTHS</Text>
          </TouchableOpacity>

          {showPast6 && (
            past6.length === 0
              ? <Text style={s.emptyTxt}>No contacts in the past 6 months.</Text>
              : past6.map(group => (
                  <View key={group.label}>
                    <Text style={[s.monthLabel, { marginTop: 10 }]}>{group.label}</Text>
                    {group.logs.map(l => <LogRow key={l.id} log={l} onLongPress={() => handleLogAction(l)} />)}
                  </View>
                ))
          )}

          {/* Bottom action row: LOG CONTACT left, REMOVE MEMBER right */}
          <View style={s.actionRow}>
            <TouchableOpacity style={s.logBtn} onPress={promptLog} disabled={logging} activeOpacity={0.7}>
              {logging
                ? <ActivityIndicator size="small" color={INK} />
                : <Text style={s.logBtnTxt}>+ LOG CONTACT</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={confirmRemove} activeOpacity={0.7}>
              <Text style={s.removeTxt}>remove member</Text>
            </TouchableOpacity>
          </View>
          </View>{/* end drawerInner */}
          <DashedLine />
        </View>
      )}

      {/* Dashed separator below every collapsed card */}
      {!expanded && <DashedLine />}
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
interface Props { userId: string | undefined }

export default function PartyView({ userId }: Props) {
  const [friends,      setFriends]      = useState<Friend[]>([]);
  const [logs,         setLogs]         = useState<ContactLog[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  const loadData = useCallback(async (silent = false) => {
    if (!userId) return;
    if (!silent) setLoading(true);
    const [{ data: fData }, { data: lData }] = await Promise.all([
      supabase.from('friends').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
      supabase.from('contact_logs').select('*').eq('user_id', userId).order('contact_date', { ascending: false }),
    ]);
    setFriends((fData ?? []) as Friend[]);
    setLogs((lData ?? []) as ContactLog[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => { loadData(); }, [loadData]);

  const addFriend = async (name: string) => {
    if (!userId) return;
    const { error } = await supabase.from('friends').insert({ user_id: userId, name });
    if (error) { Alert.alert('Error', error.message); return; }
    await loadData();
  };

  const removeFriend = async (id: string) => {
    await supabase.from('friends').delete().eq('id', id);
    await loadData();
  };

  return (
    <ScrollView style={s.root} showsVerticalScrollIndicator={false}>
      {/* Title row — Party left, add button right */}
      <View style={s.titleRow}>
        <Text style={s.title}>Party</Text>
        <TouchableOpacity style={s.addBtn} onPress={() => setShowAddModal(true)} activeOpacity={0.7}>
          <Text style={s.addBtnTxt}>add party member</Text>
          <Plus size={11} color={MUTED} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={INK} style={{ marginTop: 40 }} />
      ) : friends.length === 0 ? (
        <Text style={[s.emptyTxt, { paddingHorizontal: MARGIN }]}>No party members yet.</Text>
      ) : (
        <View style={s.list}>
          {friends.map(f => (
            <FriendCard
              key={f.id}
              friend={f}
              logs={logs.filter(l => l.friend_id === f.id)}
              userId={userId!}
              onLogAdded={() => loadData(true)}
              onRemove={removeFriend}
            />
          ))}
        </View>
      )}

      <AddFriendModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdd={addFriend}
      />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  // ── title row ──
  titleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: MARGIN, paddingTop: 16, paddingBottom: 12,
  },
  title:    { fontFamily: 'PressStart2P', fontSize: 16, color: INK, lineHeight: 26 },
  addBtn:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  addBtnTxt:{ fontFamily: 'PressStart2P', fontSize: 7, color: MUTED, lineHeight: 11 },

  list: { paddingBottom: 40 },

  // ── friend card — no border, dashed #CCC separator below ──
  cardHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: MARGIN, paddingVertical: 12, gap: 12,
    backgroundColor: BG,
  },
  sprite:     { width: SPRITE, height: SPRITE },
  cardInfo:   { flex: 1 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  friendName: { fontFamily: 'PressStart2P', fontSize: 8, color: INK, lineHeight: 12 },
  hpValue:    { fontFamily: 'PressStart2P', fontSize: 7, color: MUTED, lineHeight: 10 },

  // ── HP bar — bordered track (Figma: white bg + INK border) ──
  hpRow:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hpLabel: { fontFamily: 'PressStart2P', fontSize: 5, color: MUTED, lineHeight: 8 },
  hpTrack: {
    flex: 1, height: 9,
    backgroundColor: 'white',
    borderWidth: BORDER, borderColor: INK,
    justifyContent: 'center', paddingHorizontal: 2,
  },
  hpFill: { height: 3, backgroundColor: INK },

  // ── expanded drawer — #FCFCFC bg; dashes via DashedLine components ──
  drawer:      { backgroundColor: DRAWER_BG },
  drawerInner: { paddingHorizontal: MARGIN, paddingTop: 10, paddingBottom: 14 },
  sectionLabel: {
    fontFamily: 'PressStart2P', fontSize: 6, color: MUTED,
    lineHeight: 9, letterSpacing: 2,
  },
  monthLabel: {
    fontFamily: 'PressStart2P', fontSize: 5, color: MUTED, lineHeight: 8, marginBottom: 4,
  },

  // ── contact log row — solid #DDD bottom separator ──
  logRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: ROW_LINE,
  },
  logDate: { fontFamily: 'PressStart2P', fontSize: 7, color: INK, lineHeight: 10 },

  // ── type badge — MUTED border + MUTED text (Figma: border-[#8a8480]) ──
  badge:    {
    borderWidth: BORDER, borderColor: MUTED,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  badgeTxt: { fontFamily: 'PressStart2P', fontSize: 6, color: MUTED, lineHeight: 9, letterSpacing: 0.5 },

  // ── past 6 months toggle ──
  past6Btn: { marginTop: 10, marginBottom: 2 },
  past6Txt: { fontFamily: 'PressStart2P', fontSize: 5, color: MUTED, lineHeight: 8 },

  // ── bottom action row: log contact (left) + remove member (right) ──
  actionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 14,
  },
  logBtn:    {
    borderWidth: BORDER, borderColor: INK, borderRadius: 2,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  logBtnTxt: { fontFamily: 'PressStart2P', fontSize: 5, color: INK, lineHeight: 8 },
  removeTxt: { fontFamily: 'PressStart2P', fontSize: 5, color: MUTED, lineHeight: 8 },

  emptyTxt: { fontFamily: 'PressStart2P', fontSize: 5, color: MUTED, lineHeight: 8, paddingVertical: 6 },
});
