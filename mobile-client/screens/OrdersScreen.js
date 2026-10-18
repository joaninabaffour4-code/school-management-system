import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Button, FlatList, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { getServerUrl } from '../apiConfig';

export default function OrdersScreen({ user, accessToken, onLogout }) {
  const [data, setData] = useState(null);
  const [orders, setOrders] = useState([]);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  const role = user?.role || 'User';

  async function loadRoleData() {
    setLoading(true);
    const serverUrl = getServerUrl();
    const headers = { Authorization: `Bearer ${accessToken}` };

    try {
      if (role === 'Administrator' || role === 'admin') {
        const statsRes = await fetch(`${serverUrl}/api/admin/stats`, { headers });
        const stats = statsRes.ok ? await statsRes.json() : null;
        setData({ stats });
      } else if (role === 'Student') {
        const [attRes, grdRes] = await Promise.all([
          fetch(`${serverUrl}/api/student/attendance`, { headers }),
          fetch(`${serverUrl}/api/student/grades`, { headers }),
        ]);
        const att = attRes.ok ? await attRes.json() : null;
        const grd = grdRes.ok ? await grdRes.json() : null;
        setData({ attendance: att, grades: grd });
      } else if (role === 'Teacher') {
        const clsRes = await fetch(`${serverUrl}/api/teacher/classes`, { headers });
        const cls = clsRes.ok ? await clsRes.json() : [];
        setData({ classes: cls });
      } else if (role === 'Parent/Guardian' || role === 'Parent') {
        const chdRes = await fetch(`${serverUrl}/api/parent/children`, { headers });
        const chd = chdRes.ok ? await chdRes.json() : [];
        setData({ children: chd });
      } else {
        // Customer / Orders
        const ordRes = await fetch(`${serverUrl}/orders`, { headers });
        if (ordRes.ok) {
          const ord = await ordRes.json();
          setOrders(ord);
        }
      }
    } catch (err) {
      console.warn('Data fetch error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function createOrder() {
    if (!amount) return;
    const serverUrl = getServerUrl();
    try {
      const res = await fetch(`${serverUrl}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ totalAmount: parseFloat(amount) || 0 }),
      });
      if (res.ok) {
        setAmount('');
        loadRoleData();
      }
    } catch (err) {
      console.warn(err);
    }
  }

  useEffect(() => {
    loadRoleData();
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.welcome}>Welcome,</Text>
          <Text style={styles.username}>{user?.username || user?.email || 'User'}</Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{role}</Text>
        </View>
      </View>

      {/* Administrator View */}
      {(role === 'Administrator' || role === 'admin') && data?.stats && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🛡️ System Overview</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginVertical: 10 }}>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#1e3a8a' }}>{data.stats.totalUsers}</Text>
              <Text style={{ fontSize: 12, color: '#64748b' }}>Total Users</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#10b981' }}>{data.stats.totalStudents}</Text>
              <Text style={{ fontSize: 12, color: '#64748b' }}>Students</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#f59e0b' }}>{data.stats.totalTeachers}</Text>
              <Text style={{ fontSize: 12, color: '#64748b' }}>Teachers</Text>
            </View>
          </View>
          <Text style={[styles.cardTitle, { marginTop: 14 }]}>☁️ Cloud Backup Status</Text>
          <Text style={styles.itemSub}>
            {data.stats.lastBackup ? `Latest S3 Backup: ${data.stats.lastBackup.filename} (${data.stats.lastBackup.status})` : 'AWS S3 Backup: Active (Scheduled)'}
          </Text>
        </View>
      )}

      {/* Student View */}
      {role === 'Student' && data?.attendance && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📊 Attendance Summary</Text>
          <Text style={styles.bigStat}>{data.attendance.stats?.percentage ?? 100}%</Text>
          <Text style={styles.statSub}>
            Present: {data.attendance.stats?.present} / {data.attendance.stats?.total} days
          </Text>
          <Text style={styles.cardTitle}>🎓 Published Grades</Text>
          {data.grades && data.grades.length > 0 ? (
            data.grades.map((g, idx) => (
              <View key={idx} style={styles.gradeRow}>
                <Text style={styles.gradeSubject}>{g.subject_name}</Text>
                <Text style={styles.gradeScore}>{g.grade_letter} ({g.marks_obtained}%)</Text>
              </View>
            ))
          ) : (
            <Text style={styles.mutedText}>No grades published yet.</Text>
          )}
        </View>
      )}

      {/* Teacher View */}
      {role === 'Teacher' && data?.classes && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📚 Assigned Classes & Subjects</Text>
          {data.classes.map((c, idx) => (
            <View key={idx} style={styles.itemRow}>
              <Text style={styles.itemBold}>{c.class_name}</Text>
              <Text style={styles.itemSub}>{c.subject_name} ({c.subject_code})</Text>
            </View>
          ))}
        </View>
      )}

      {/* Parent View */}
      {(role === 'Parent/Guardian' || role === 'Parent') && data?.children && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>👨‍👧‍👦 Officially Linked Children</Text>
          {data.children.map((c, idx) => (
            <View key={idx} style={styles.itemRow}>
              <Text style={styles.itemBold}>{c.first_name} {c.last_name}</Text>
              <Text style={styles.itemSub}>Admission: {c.admission_number || 'N/A'} • Class: {c.class_name || '10A'}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Orders / Legacy View */}
      {orders.length > 0 || role === 'customer' || role === 'Customer' ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🛍️ Orders History</Text>
          {orders.map((item) => (
            <View key={String(item.id)} style={styles.itemRow}>
              <Text style={styles.itemBold}>Order #{item.id}</Text>
              <Text style={styles.itemSub}>Status: {item.status} • Total: ${item.total_amount || item.totalAmount}</Text>
            </View>
          ))}
          <TextInput
            placeholder="Order Amount ($)"
            value={amount}
            onChangeText={setAmount}
            style={styles.input}
            keyboardType="numeric"
          />
          <Button title="Create New Order" onPress={createOrder} color="#1e3a8a" />
        </View>
      ) : null}

      <View style={{ marginTop: 24 }}>
        <Button title="Refresh Portal Data" onPress={loadRoleData} color="#3b82f6" />
        <View style={{ height: 10 }} />
        {onLogout && <Button title="Sign Out" onPress={onLogout} color="#ef4444" />}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 18, backgroundColor: '#f8fafc', flexGrow: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  welcome: { fontSize: 13, color: '#64748b' },
  username: { fontSize: 20, fontWeight: 'bold', color: '#1e293b' },
  badge: { backgroundColor: '#1e3a8a', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  badgeText: { color: '#ffffff', fontSize: 12, fontWeight: 'bold' },
  card: { backgroundColor: '#ffffff', borderRadius: 10, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  cardTitle: { fontSize: 15, fontWeight: 'bold', color: '#1e3a8a', marginBottom: 10, marginTop: 4 },
  bigStat: { fontSize: 32, fontWeight: 'bold', color: '#10b981', textAlign: 'center', marginVertical: 6 },
  statSub: { fontSize: 13, color: '#64748b', textAlign: 'center', marginBottom: 12 },
  gradeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  gradeSubject: { fontSize: 14, color: '#334155' },
  gradeScore: { fontSize: 14, fontWeight: 'bold', color: '#1e3a8a' },
  itemRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  itemBold: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  itemSub: { fontSize: 12, color: '#64748b', marginTop: 2 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 10, marginTop: 12, marginBottom: 8 },
  mutedText: { fontSize: 13, color: '#94a3b8', fontStyle: 'italic', marginVertical: 4 },
});
