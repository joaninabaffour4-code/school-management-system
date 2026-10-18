import React, { useState } from 'react';
import { View, TextInput, Button, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { getServerUrl } from '../apiConfig';

export default function RegisterScreen({ onDone }) {
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('Student');
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function doRegister() {
    setMessage('');
    setLoading(true);

    if (!username.trim() || !firstName.trim() || !lastName.trim() || !email.trim() || !password) {
      setLoading(false);
      setMessage('Please fill in all required fields.');
      return;
    }

    try {
      const server = getServerUrl();
      const res = await fetch(`${server}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim().toLowerCase(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim().toLowerCase(),
          password,
          role,
        }),
      });

      const body = await res.json();
      setLoading(false);

      if (!res.ok) {
        setMessage(body.message || body.error || 'Registration failed.');
        return;
      }

      setSuccess(true);
      setMessage('Account registered successfully! You can now log in.');
      setTimeout(() => onDone(), 2000);
    } catch (err) {
      setLoading(false);
      setMessage(`Network error: ${err.message}`);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>🏫 Create Account</Text>
      <Text style={styles.subtitle}>Register as a Student or Parent/Guardian</Text>

      <Text style={styles.label}>First Name:</Text>
      <TextInput placeholder="First Name" value={firstName} onChangeText={setFirstName} style={styles.input} />

      <Text style={styles.label}>Last Name:</Text>
      <TextInput placeholder="Last Name" value={lastName} onChangeText={setLastName} style={styles.input} />

      <Text style={styles.label}>Username:</Text>
      <TextInput
        placeholder="e.g. j_doe"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />

      <Text style={styles.label}>Email:</Text>
      <TextInput
        placeholder="email@school.edu"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        style={styles.input}
      />

      <Text style={styles.label}>Role:</Text>
      <View style={styles.roleRow}>
        <TouchableOpacity
          onPress={() => setRole('Student')}
          style={[styles.roleBtn, role === 'Student' && styles.roleBtnActive]}
        >
          <Text style={[styles.roleBtnText, role === 'Student' && styles.roleBtnTextActive]}>Student</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setRole('Parent/Guardian')}
          style={[styles.roleBtn, role === 'Parent/Guardian' && styles.roleBtnActive]}
        >
          <Text style={[styles.roleBtnText, role === 'Parent/Guardian' && styles.roleBtnTextActive]}>Parent</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Password (min 8 chars):</Text>
      <TextInput
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={styles.input}
      />

      <Button
        title={loading ? 'Registering...' : 'Register Account'}
        onPress={doRegister}
        disabled={loading}
        color="#1e3a8a"
      />

      <View style={{ height: 10 }} />
      <Button title="Back to Login" onPress={onDone} color="#64748b" />

      {message ? (
        <Text style={[styles.messageBox, success ? styles.successBox : styles.errorBox]}>{message}</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, flexGrow: 1, backgroundColor: '#f8fafc', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: 'bold', color: '#1e3a8a', textAlign: 'center', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#64748b', textAlign: 'center', marginBottom: 18 },
  label: { fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 10, marginBottom: 12, backgroundColor: '#fff', fontSize: 14 },
  roleRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  roleBtn: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1', alignItems: 'center', backgroundColor: '#fff' },
  roleBtnActive: { backgroundColor: '#1e3a8a', borderColor: '#1e3a8a' },
  roleBtnText: { color: '#475569', fontWeight: '600', fontSize: 13 },
  roleBtnTextActive: { color: '#fff' },
  messageBox: { marginTop: 14, padding: 12, borderRadius: 8, textAlign: 'center', fontSize: 13 },
  errorBox: { backgroundColor: '#fee2e2', color: '#991b1b' },
  successBox: { backgroundColor: '#dcfce7', color: '#166534' },
});
