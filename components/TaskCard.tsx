import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Borders, Fonts, FontSizes } from '../constants/theme';

export interface Task {
  id: string;
  title: string;
  categoryId: string;
  scheduledTime?: string;
  durationMinutes?: number;
  isRecurring: boolean;
  isCompleted: boolean;
  timePeriod: 'morning' | 'afternoon' | 'evening' | 'unscheduled';
  isTTFO: boolean;
}

interface Props {
  task: Task;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function TaskCard({ task, onToggle, onDelete }: Props) {
  return (
    <View style={[s.card, task.isCompleted && s.faded]}>
      <TouchableOpacity style={s.check} onPress={() => onToggle(task.id)}>
        <View style={[s.box, task.isCompleted && s.boxDone]}>
          {task.isCompleted && <Text style={s.tick}>✓</Text>}
        </View>
      </TouchableOpacity>
      <View style={s.content}>
        <Text style={[s.title, task.isCompleted && s.strikethrough]} numberOfLines={1}>
          {task.title}
        </Text>
        {task.scheduledTime && (
          <Text style={s.sub}>
            {task.scheduledTime}{task.durationMinutes ? ` · ${task.durationMinutes}m` : ''}
          </Text>
        )}
      </View>
      <TouchableOpacity onPress={() => onDelete(task.id)} style={s.del}>
        <Text style={s.delText}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

const INK    = Colors.ink;
const BG     = Colors.background;
const MUTED  = Colors.muted;
const BORDER = Borders.card.borderWidth;
const RADIUS = Borders.radius;

const s = StyleSheet.create({
  card:         { flexDirection: 'row', alignItems: 'center', marginHorizontal: 18, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 10, borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, backgroundColor: BG, gap: 10 },
  faded:        { opacity: 0.5 },
  check:        { padding: 2 },
  box:          { width: 18, height: 18, borderWidth: BORDER, borderColor: INK, alignItems: 'center', justifyContent: 'center' },
  boxDone:      { backgroundColor: INK },
  tick:         { fontFamily: Fonts.ui, fontSize: 8, color: BG, lineHeight: 10 },
  content:      { flex: 1 },
  title:        { fontFamily: Fonts.content, fontSize: FontSizes.taskName, color: INK, lineHeight: 20 },
  strikethrough:{ textDecorationLine: 'line-through' },
  sub:          { fontFamily: Fonts.ui, fontSize: FontSizes.labelSm, color: MUTED, lineHeight: 9, marginTop: 2 },
  del:          { padding: 4 },
  delText:      { fontFamily: Fonts.ui, fontSize: 9, color: MUTED, lineHeight: 12 },
});
