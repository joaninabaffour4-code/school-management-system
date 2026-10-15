import React, { useState } from 'react';
import { View, TextInput, Button, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { getServerUrl, setServerUrl, LOCAL_WIFI_IP, PORT, PUBLIC_HTTPS_URL } from '../apiConfig';

export default function LoginScreen({ onLogin, onRegister }) {
  const [identifier, setIdentifier] = useState('admin');
  const [password, setPassword] = useState('Admin@123');
  const [serverEndpoint, setServerEndpoint] = useState(getServerUrl());
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function doLogin() {
    setMessage('');
    setLoading(true);
    setServerUrl(serverEndpoint);

    try {
      const url = `${serverEndpoint}/api/auth/login`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: identifier.trim(),
          email: identifier.trim(),
          password: password,
        }),
      });

      const body = await res.json();
      setLoading(false);

      if (!res.ok) {
        setMessage(body.message || body.error || 'Login failed. Check credentials.');
        return;
      }

      if (body.twoFactorRequired) {
        onLogin({ username: identifier, email: identifier }, body.tempToken, true);
      } else {
        onLogin(body.user || { username: identifier }, body.token || body.accessToken, false);
      }
    } catch (err) {
      setLoading(false);
      setMessage(`Connection Error: ${err.message}. Make sure your phone is on the same Wi-Fi as your computer (${serverEndpoint}).`);
    }
  }

  function setPreset(ip) {
    const newUrl = `http://${ip}:${PORT}`;
    setServerEndpoint(newUrl);
    setServerUrl(newUrl);
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>🏫 School Management Mobile</Text>
      <Text style={styles.subtitle}>Log in using your account credentials</Text>

      <View style={styles.serverBox}>
        <Text style={styles.label}>Backend Server URL:</Text>
        <TextInput
          value={serverEndpoint}
          onChangeText={setServerEndpoint}
          style={styles.serverInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={styles.presetRow}>
          <TouchableOpacity onPress={() => { setServerEndpoint(PUBLIC_HTTPS_URL); setServerUrl(PUBLIC_HTTPS_URL); }} style={[styles.presetBtn, { backgroundColor: '#10b981' }]}>
            <Text style={[styles.presetText, { color: '#fff', fontWeight: 'bold' }]}>🌐 Public Live</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setPreset(LOCAL_WIFI_IP)} style={styles.presetBtn}>
            <Text style={styles.presetText}>Wi-Fi</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setPreset('10.0.2.2')} style={styles.presetBtn}>
            <Text style={styles.presetText}>Emulator</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setPreset('localhost')} style={styles.presetBtn}>
            <Text style={styles.presetText}>Localhost</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.label}>Username or Email:</Text>
      <TextInput
        placeholder="admin / teacher1 / student1 / parent1"
        value={identifier}
        onChangeText={setIdentifier}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>Password:</Text>
      <TextInput
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={styles.input}
      />

      <Button
        title={loading ? 'Authenticating...' : 'Sign In'}
        onPress={doLogin}
        disabled={loading}
        color="#1e3a8a"
      />

      <View style={{ height: 12 }} />
      <Button
        title="Create New Account"
        onPress={onRegister}
        color="#64748b"
      />

      {message ? <Text style={styles.error}>{message}</Text> : null}

      <View style={styles.demoBox}>
        <Text style={styles.demoTitle}>Demonstration Credentials:</Text>
        <Text style={styles.demoText}>• Admin: admin / Admin@123</Text>
        <Text style={styles.demoText}>• Teacher: teacher1 / Password@123</Text>
        <Text style={styles.demoText}>• Student: student1 / Password@123</Text>
        <Text style={styles.demoText}>• Parent: parent1 / Password@123</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, flexGrow: 1, backgroundColor: '#f8fafc', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: 'bold', color: '#1e3a8a', textAlign: 'center', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#64748b', textAlign: 'center', marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 12, marginBottom: 14, backgroundColor: '#fff', fontSize: 15 },
  serverBox: { backgroundColor: '#e2e8f0', padding: 12, borderRadius: 8, marginBottom: 16 },
  serverInput: { borderWidth: 1, borderColor: '#94a3b8', borderRadius: 6, padding: 8, backgroundColor: '#fff', fontSize: 13, marginBottom: 8 },
  presetRow: { flexDirection: 'row', justifyContent: 'space-between' },
  presetBtn: { backgroundColor: '#cbd5e1', paddingVertical: 4, paddingHorizontal: 6, borderRadius: 4 },
  presetText: { fontSize: 10, color: '#1e293b', fontWeight: '500' },
  error: { color: '#dc2626', marginTop: 12, backgroundColor: '#fee2e2', padding: 10, borderRadius: 6, fontSize: 13 },
  demoBox: { marginTop: 24, padding: 12, backgroundColor: '#f1f5f9', borderRadius: 8, borderLeftWidth: 4, borderLeftColor: '#3b82f6' },
  demoTitle: { fontWeight: 'bold', fontSize: 12, color: '#1e293b', marginBottom: 4 },
  demoText: { fontSize: 12, color: '#475569', marginVertical: 1 },
});
