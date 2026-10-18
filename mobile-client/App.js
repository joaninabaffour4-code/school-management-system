import React, { useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import LoginScreen from './screens/LoginScreen';
import RegisterScreen from './screens/RegisterScreen';
import TwoFAScreen from './screens/TwoFAScreen';
import OrdersScreen from './screens/OrdersScreen';

export default function App() {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [twoFactorTemp, setTwoFactorTemp] = useState(null);

  function handleLogout() {
    setUser(null);
    setAccessToken(null);
    setTwoFactorTemp(null);
  }

  if (!user || user === 'register') {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" />
        {user === 'register' ? (
          <RegisterScreen onDone={() => setUser(null)} />
        ) : (
          <LoginScreen
            onLogin={(u, token, twoFactorRequired) => {
              if (twoFactorRequired) {
                setUser(u);
                setTwoFactorTemp(token);
              } else {
                setUser(u);
                setAccessToken(token);
                setTwoFactorTemp(null);
              }
            }}
            onRegister={() => setUser('register')}
          />
        )}
      </SafeAreaView>
    );
  }

  if (twoFactorTemp) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" />
        <TwoFAScreen
          tempToken={twoFactorTemp}
          onSuccess={(token, verifiedUser) => {
            if (verifiedUser) setUser(verifiedUser);
            setAccessToken(token);
            setTwoFactorTemp(null);
          }}
          onCancel={handleLogout}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <OrdersScreen
        user={user}
        accessToken={accessToken}
        onLogout={handleLogout}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
});
