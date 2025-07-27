#!/bin/bash

# Test script for the Node.js backend
echo "🚀 Testing Backend Para Rinha 2025 - Node.js Version"
echo

# Check if the API is running
echo "📡 Checking if API is responding..."
API_URL="http://localhost:9999"

# Test health endpoint (implicit - the API should respond)
echo "Testing basic connectivity..."
curl -s -o /dev/null -w "%{http_code}" $API_URL/payments-summary
echo

# Test adding a payment
echo "💳 Testing payment submission..."
PAYMENT_RESULT=$(curl -s -X POST $API_URL/payments \
  -H "Content-Type: application/json" \
  -d '{"correlationId": "test-123", "amount": 100.50}' \
  -w "%{http_code}")

echo "Payment submission result: $PAYMENT_RESULT"

# Test getting summary
echo "📊 Testing payments summary..."
SUMMARY_RESULT=$(curl -s $API_URL/payments-summary)
echo "Summary result: $SUMMARY_RESULT"

# Test purge (optional - use with caution)
echo "🧹 Testing purge payments..."
PURGE_RESULT=$(curl -s -X POST $API_URL/purge-payments)
echo "Purge result: $PURGE_RESULT"

echo
echo "✅ Testing completed!"
