import { useState, useEffect } from 'react';
import { auth, db } from '../../firebase/config';
import { doc, setDoc, getDoc } from 'firebase/firestore';

// Comprehensive list of common B2B job titles
const JOB_TITLES = [
  // C-Suite
  "CEO", "CFO", "COO", "CTO", "CMO", "CIO", "CHRO", "CPO",
  // VPs
  "VP of Sales", "VP of Marketing", "VP of Operations", "VP of Engineering", "VP of Product", "VP of Finance",
  // Directors
  "Director of Sales", "Director of Marketing", "Director of Operations", "Director of Engineering",
  "Director of Product", "Director of Finance", "Director of HR", "Director of IT",
  // Managers
  "Sales Manager", "Marketing Manager", "Operations Manager", "Engineering Manager",
  "Product Manager", "Finance Manager", "HR Manager", "IT Manager", "Account Manager",
  // Sales Roles
  "Account Executive", "Business Development Manager", "Sales Development Representative",
  "Customer Success Manager", "Sales Operations Manager", "Revenue Operations Manager",
  // Marketing Roles
  "Digital Marketing Manager", "Content Marketing Manager", "Growth Marketing Manager",
  "Brand Manager", "Product Marketing Manager", "Demand Generation Manager",
  // Engineering Roles
  "Software Engineer", "Senior Software Engineer", "Engineering Lead", "DevOps Engineer",
  "Data Engineer", "ML Engineer", "QA Engineer",
  // Operations
  "Operations Analyst", "Business Analyst", "Project Manager", "Program Manager",
  "Scrum Master", "Agile Coach",
  // HR & People
  "Recruiter", "Talent Acquisition Manager", "People Operations Manager", "Learning & Development Manager",
  // Finance
  "Controller", "Financial Analyst", "Accountant", "FP&A Manager",
  // IT
  "IT Director", "Systems Administrator", "Network Engineer", "Security Engineer", "IT Support Manager",
  // Founder/Owner
  "Founder", "Co-Founder", "Owner", "Partner", "President"
];

export default function ContactTitleSetup({ onComplete }) {
  const [selectedTitles, setSelectedTitles] = useState([]);
  const [titleSearch, setTitleSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState(null);

  useEffect(() => {
    loadExistingPreferences();
  }, []);

  const loadExistingPreferences = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const titlePrefsRef = doc(db, 'users', user.uid, 'contactScoring', 'titlePreferences');
      const titlePrefsDoc = await getDoc(titlePrefsRef);

      if (titlePrefsDoc.exists()) {
        const data = titlePrefsDoc.data();
        setSelectedTitles(data.titles || []);
      }
    } catch (error) {
      console.error('Error loading title preferences:', error);
    }
  };

  const handleAddTitle = (title) => {
    if (selectedTitles.find(t => t.title === title)) {
      // Already selected - remove it
      setSelectedTitles(selectedTitles.filter(t => t.title !== title));
    } else {
      // Add with default priority score of 50
      setSelectedTitles([...selectedTitles, {
        title,
        priority: 50,
        order: selectedTitles.length
      }]);
    }
  };

  const handlePriorityChange = (title, priority) => {
    setSelectedTitles(selectedTitles.map(t =>
      t.title === title ? { ...t, priority: parseInt(priority) } : t
    ));
  };

  const handleDragStart = (index) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newTitles = [...selectedTitles];
    const draggedItem = newTitles[draggedIndex];
    newTitles.splice(draggedIndex, 1);
    newTitles.splice(index, 0, draggedItem);

    // Update order
    newTitles.forEach((t, i) => t.order = i);

    setSelectedTitles(newTitles);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const handleSave = async () => {
    if (selectedTitles.length === 0) {
      alert('Please select at least one job title to target');
      return;
    }

    setSaving(true);

    try {
      const user = auth.currentUser;
      if (!user) return;

      // Save title preferences to Firestore
      const titlePrefsRef = doc(db, 'users', user.uid, 'contactScoring', 'titlePreferences');
      await setDoc(titlePrefsRef, {
        titles: selectedTitles,
        updatedAt: new Date().toISOString()
      });

      console.log('✅ Title preferences saved!');
      onComplete();

    } catch (error) {
      console.error('❌ Error saving title preferences:', error);
      alert('Failed to save preferences. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const filteredTitles = JOB_TITLES.filter(title =>
    title.toLowerCase().includes(titleSearch.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-lg">
      <div className="bg-gradient-to-br from-gray-900 to-black border-2 border-cyan-500/30 rounded-3xl max-w-4xl w-full mx-6 max-h-[90vh] overflow-y-auto">
        <div className="p-10">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="text-6xl mb-4">🎯</div>
            <h2 className="text-4xl font-bold text-white mb-3 font-mono">
              Contact Title Preferences
            </h2>
            <p className="text-gray-400 text-lg">
              Select the job titles you want to target and prioritize them
            </p>
          </div>

          {/* Selected Titles (Drag to Reorder) */}
          {selectedTitles.length > 0 && (
            <div className="mb-8">
              <h3 className="text-xl font-bold text-cyan-400 mb-4 font-mono">
                Your Target Titles ({selectedTitles.length})
              </h3>
              <p className="text-gray-400 text-sm mb-4">
                💡 Drag to reorder by priority. Higher = more important.
              </p>

              <div className="space-y-3 max-h-64 overflow-y-auto bg-black/40 rounded-xl p-4 border border-cyan-500/20">
                {selectedTitles.map((item, index) => (
                  <div
                    key={item.title}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    className={`bg-gradient-to-r from-cyan-900/30 to-blue-900/30 rounded-xl p-4 border border-cyan-500/30 cursor-move hover:border-cyan-500/60 transition-all ${
                      draggedIndex === index ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      {/* Drag Handle */}
                      <div className="text-2xl text-gray-500">⋮⋮</div>

                      {/* Order Number */}
                      <div className="bg-cyan-500/20 text-cyan-400 w-10 h-10 rounded-full flex items-center justify-center font-mono font-bold">
                        {index + 1}
                      </div>

                      {/* Title */}
                      <div className="flex-1">
                        <p className="text-white font-bold font-mono">{item.title}</p>
                      </div>

                      {/* Priority Slider */}
                      <div className="flex items-center gap-3 min-w-[200px]">
                        <label className="text-gray-400 text-sm font-mono whitespace-nowrap">
                          Priority: {item.priority}
                        </label>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={item.priority}
                          onChange={(e) => handlePriorityChange(item.title, e.target.value)}
                          className="flex-1"
                        />
                      </div>

                      {/* Remove Button */}
                      <button
                        onClick={() => handleAddTitle(item.title)}
                        className="text-red-400 hover:text-red-300 text-xl"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Search & Select Titles */}
          <div>
            <h3 className="text-xl font-bold text-white mb-4 font-mono">
              Add Job Titles
            </h3>

            {/* Search Box */}
            <input
              type="text"
              placeholder="🔍 Search job titles..."
              value={titleSearch}
              onChange={(e) => setTitleSearch(e.target.value)}
              className="w-full bg-black/60 text-white px-4 py-3 rounded-lg border border-cyan-500/30 mb-4 focus:outline-none focus:border-cyan-500"
            />

            {/* Title Grid */}
            <div className="max-h-64 overflow-y-auto bg-black/40 rounded-xl p-4 border border-cyan-500/20">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {filteredTitles.map(title => {
                  const isSelected = selectedTitles.find(t => t.title === title);
                  return (
                    <button
                      key={title}
                      onClick={() => handleAddTitle(title)}
                      className={`px-4 py-3 rounded-lg font-mono text-sm transition-all ${
                        isSelected
                          ? 'bg-cyan-500/30 text-cyan-400 border-2 border-cyan-500'
                          : 'bg-gray-800/50 text-gray-400 border border-gray-700 hover:border-cyan-500/50 hover:text-white'
                      }`}
                    >
                      {isSelected ? '✓ ' : ''}{title}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mt-8 flex gap-4">
            <button
              onClick={handleSave}
              disabled={saving || selectedTitles.length === 0}
              className={`flex-1 font-bold py-5 rounded-xl transition-all font-mono text-lg ${
                saving || selectedTitles.length === 0
                  ? 'bg-gray-600 cursor-not-allowed text-gray-400'
                  : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-2xl shadow-cyan-500/50'
              }`}
            >
              {saving ? '⏳ SAVING...' : '✅ SAVE PREFERENCES'}
            </button>

            <button
              onClick={() => {
                if (selectedTitles.length === 0) {
                  alert('Please select at least one job title before skipping');
                  return;
                }
                onComplete();
              }}
              className="px-8 py-5 bg-gray-700/50 hover:bg-gray-700/70 text-gray-300 font-bold rounded-xl transition-all font-mono text-lg border border-gray-600"
            >
              SKIP FOR NOW
            </button>
          </div>

          {selectedTitles.length === 0 && (
            <p className="text-red-400 text-sm text-center mt-4">
              ⚠️ Please select at least one job title to continue
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
