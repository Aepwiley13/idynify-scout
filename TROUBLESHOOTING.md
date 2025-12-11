# 🔧 Lead Generation Not Working? Here's What To Check

## Problem: Barry hasn't generated leads after 5+ minutes

### **Root Cause Found:**
The `generate-leads-v2` function had an **8-second timeout** hardcoded, causing it to fail silently. This has been fixed in the latest commit.

---

## ✅ **Fixes Applied (Just Pushed):**

1. **Increased internal timeout**: 8 seconds → 10 minutes
2. **Added Netlify config**: Added `generate-leads-v2` timeout to netlify.toml (900 seconds)
3. **Will deploy automatically** when Netlify rebuilds

---

## 🚨 **For Users Currently Stuck:**

If you already approved your ICP but no leads appeared, here's how to retry:

### **Option 1: Quick Fix (Browser Console)**
Open browser console (F12) and run:
```javascript
// Check if Barry is still generating
const user = firebase.auth().currentUser;
firebase.firestore().doc(`users/${user.uid}`).get().then(doc => {
  console.log('User data:', doc.data());
  console.log('Leads:', doc.data().leads?.length || 0);
  console.log('Barry generating?', doc.data().barryGeneratingLeads);
  console.log('Error?', doc.data().leadGenerationError);
});
```

If `barryGeneratingLeads: true` but it's been >5 min, the function failed silently.

### **Option 2: Force Regenerate (After Timeout Fix Deploys)**
1. Wait for Netlify to deploy the timeout fix (~2-3 minutes)
2. Go back to the ICP validation page: `/icp-validation`
3. Click "LAUNCH LEAD SEARCH" again
4. Barry will retry with the new 10-minute timeout

---

## 📊 **How to Monitor Lead Generation:**

### **Check Netlify Function Logs:**
```bash
cd /Users/mac/Desktop/idynify-scout-deploy
netlify functions:log generate-leads-v2
```

Or go to: Netlify Dashboard → Functions → generate-leads-v2 → Logs

### **Expected Timeline:**
- **0-30 seconds**: Barry analyzes ICP and creates search strategy
- **30-60 seconds**: Discovers companies from Apollo
- **1-3 minutes**: AI scores companies against your ICP
- **3-5 minutes**: Finds decision-makers at top companies
- **Total: 3-5 minutes typically**

If it takes >5 minutes, check logs for errors.

---

## 🐛 **Common Issues:**

### **Issue 1: Function Timeout (FIXED)**
**Symptom**: No leads after 5+ minutes, no error shown
**Cause**: 8-second timeout was killing the function
**Fix**: Applied in latest commit (10-minute timeout)

### **Issue 2: Apollo API Rate Limit**
**Symptom**: "Rate limit exceeded" in logs
**Cause**: Too many API calls in short time
**Fix**: Wait 1 minute, try again

### **Issue 3: No Companies Found**
**Symptom**: "No companies found" message
**Cause**: Search criteria too narrow
**Fix**:
- Check your industries aren't too niche
- Broaden company size ranges
- Check location isn't too specific

### **Issue 4: Firebase Not Updating**
**Symptom**: Dashboard says "Barry is searching..." forever
**Cause**: Real-time listener not working
**Fix**: Refresh page (listener should reconnect)

---

## 🔍 **Debug Checklist:**

When leads don't appear:

- [ ] Check browser console for errors (F12)
- [ ] Check Network tab for failed API calls
- [ ] Verify you're logged in (check Firebase auth)
- [ ] Check if `barryGeneratingLeads` flag is stuck as `true`
- [ ] Check Netlify function logs for errors
- [ ] Verify timeout fix has deployed
- [ ] Try clearing cache and refreshing

---

## 🚀 **Next Steps After Fix Deploys:**

1. **Netlify will auto-deploy** in ~2-3 minutes
2. **New users** will work automatically
3. **Existing stuck users**: Navigate back to `/icp-validation` and re-trigger

---

## 📞 **If Still Not Working:**

Check these locations:
1. Browser Console (F12) → Look for red errors
2. Netlify Logs → Functions → generate-leads-v2
3. Firebase Console → Users collection → Check your user doc
4. Network Tab (F12) → Look for failed requests to `/.netlify/functions/generate-leads-v2`

The function should now take 3-5 minutes and complete successfully!
