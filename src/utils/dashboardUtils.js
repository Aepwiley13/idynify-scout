import { doc, updateDoc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import dashboardSchemaData from '../schemas/dashboardSchema.json';

/**
 * Update a section's status and data
 */
export async function updateSectionStatus(userId, moduleId, sectionId, updates) {
  try {
    const dashboardRef = doc(db, 'dashboards', userId);
    const dashboardDoc = await getDoc(dashboardRef);

    if (!dashboardDoc.exists()) {
      throw new Error('Dashboard not found');
    }

    const dashboardData = dashboardDoc.data();
    const modules = [...dashboardData.modules];
    const moduleIndex = modules.findIndex(m => m.id === moduleId);

    if (moduleIndex === -1) {
      throw new Error(`Module ${moduleId} not found`);
    }

    const sections = [...modules[moduleIndex].sections];
    const sectionIndex = sections.findIndex(s => s.sectionId === sectionId);

    if (sectionIndex === -1) {
      throw new Error(`Section ${sectionId} not found`);
    }

    // Check if this is a new completion (before updating)
    const wasAlreadyCompleted = sections[sectionIndex].status === 'completed';
    const isBeingCompleted = updates.status === 'completed';

    // Update section
    sections[sectionIndex] = {
      ...sections[sectionIndex],
      ...updates,
      lastEditedAt: new Date().toISOString()
    };

    // If section is being completed for the first time, unlock next section
    if (isBeingCompleted && !wasAlreadyCompleted) {
      console.log(`🔓 Section ${sectionId} completed! Unlocking next section...`);

      // Unlock next section
      if (sectionIndex + 1 < sections.length) {
        sections[sectionIndex + 1].unlocked = true;
        console.log(`✅ Section ${sections[sectionIndex + 1].sectionId} unlocked!`);
      }
    }

    // Recalculate module progress
    const completedSections = sections.filter(s => s.status === 'completed').length;
    const progressPercentage = Math.round((completedSections / sections.length) * 100);

    modules[moduleIndex].sections = sections;
    modules[moduleIndex].completedSections = completedSections;
    modules[moduleIndex].progressPercentage = progressPercentage;

    // Update module status
    if (completedSections === 0) {
      modules[moduleIndex].status = 'not_started';
    } else if (completedSections === sections.length) {
      modules[moduleIndex].status = 'completed';
      modules[moduleIndex].completedAt = new Date().toISOString();

      // Unlock next module when current module is completed
      if (moduleIndex + 1 < modules.length) {
        const nextModule = modules[moduleIndex + 1];
        if (!nextModule.unlocked) {
          console.log(`🔓 Module ${moduleId} completed! Unlocking next module: ${nextModule.id}`);
          modules[moduleIndex + 1].unlocked = true;
          modules[moduleIndex + 1].status = 'not_started';
          // Unlock first section of next module
          if (modules[moduleIndex + 1].sections && modules[moduleIndex + 1].sections.length > 0) {
            modules[moduleIndex + 1].sections[0].unlocked = true;
          }
        }
      }
    } else {
      modules[moduleIndex].status = 'in-progress';
      if (!modules[moduleIndex].startedAt) {
        modules[moduleIndex].startedAt = new Date().toISOString();
      }
    }

    // Update overall progress
    const totalSections = modules.reduce((sum, m) => sum + m.totalSections, 0);
    const totalCompleted = modules.reduce((sum, m) => sum + m.completedSections, 0);
    const overallProgress = totalSections > 0 ? Math.round((totalCompleted / totalSections) * 100) : 0;

    // Update milestones
    const progressTracking = updateMilestones(dashboardData.progressTracking, modules, overallProgress);

    // Save to Firestore
    await updateDoc(dashboardRef, {
      modules,
      'progressTracking.overallProgress': overallProgress,
      'progressTracking.moduleProgress': {
        recon: modules.find(m => m.id === 'recon')?.progressPercentage || 0,
        scout: modules.find(m => m.id === 'scout')?.progressPercentage || 0,
        sniper: modules.find(m => m.id === 'sniper')?.progressPercentage || 0
      },
      'progressTracking.milestones': progressTracking.milestones,
      lastUpdatedAt: new Date().toISOString()
    });

    console.log('✅ Section updated successfully');
    console.log(`📊 Module progress: ${completedSections}/${sections.length} sections (${progressPercentage}%)`);

    // Return updated section data for verification
    return {
      success: true,
      section: sections[sectionIndex],
      nextSection: sectionIndex + 1 < sections.length ? sections[sectionIndex + 1] : null,
      moduleProgress: progressPercentage
    };
  } catch (error) {
    console.error('❌ Error updating section:', error);
    throw error;
  }
}

/**
 * Update milestones based on progress
 */
function updateMilestones(progressTracking, modules, overallProgress) {
  const milestones = [...progressTracking.milestones];
  const reconModule = modules.find(m => m.id === 'recon');

  // RECON Started
  const reconStartedIndex = milestones.findIndex(m => m.id === 'recon-started');
  if (reconStartedIndex !== -1 && !milestones[reconStartedIndex].achieved && reconModule?.startedAt) {
    milestones[reconStartedIndex].achieved = true;
    milestones[reconStartedIndex].achievedAt = reconModule.startedAt;
  }

  // RECON 50% Complete
  const recon50Index = milestones.findIndex(m => m.id === 'recon-50-percent');
  if (recon50Index !== -1 && !milestones[recon50Index].achieved && reconModule?.progressPercentage >= 50) {
    milestones[recon50Index].achieved = true;
    milestones[recon50Index].achievedAt = new Date().toISOString();
  }

  // RECON Completed
  const reconCompletedIndex = milestones.findIndex(m => m.id === 'recon-completed');
  if (reconCompletedIndex !== -1 && !milestones[reconCompletedIndex].achieved && reconModule?.status === 'completed') {
    milestones[reconCompletedIndex].achieved = true;
    milestones[reconCompletedIndex].achievedAt = reconModule.completedAt;
  }

  return { ...progressTracking, milestones };
}

/**
 * Save section data
 */
export async function saveSectionData(userId, moduleId, sectionId, data) {
  try {
    const dashboardRef = doc(db, 'dashboards', userId);
    const dashboardDoc = await getDoc(dashboardRef);

    if (!dashboardDoc.exists()) {
      throw new Error('Dashboard not found');
    }

    const dashboardData = dashboardDoc.data();
    const modules = [...dashboardData.modules];
    const moduleIndex = modules.findIndex(m => m.id === moduleId);
    const sectionIndex = modules[moduleIndex].sections.findIndex(s => s.sectionId === sectionId);

    // Update section data
    modules[moduleIndex].sections[sectionIndex].data = data;
    modules[moduleIndex].sections[sectionIndex].lastEditedAt = new Date().toISOString();
    modules[moduleIndex].sections[sectionIndex].version += 1;

    // Save to Firestore
    await updateDoc(dashboardRef, {
      modules,
      lastUpdatedAt: new Date().toISOString()
    });

    console.log(`✅ Section ${sectionId} data saved (version ${modules[moduleIndex].sections[sectionIndex].version})`);
    return {
      success: true,
      section: modules[moduleIndex].sections[sectionIndex]
    };
  } catch (error) {
    console.error('❌ Error saving section data:', error);
    throw error;
  }
}

/**
 * Get current dashboard state
 */
export async function getDashboardState(userId) {
  try {
    const dashboardRef = doc(db, 'dashboards', userId);
    const dashboardDoc = await getDoc(dashboardRef);

    if (!dashboardDoc.exists()) {
      return null;
    }

    const data = dashboardDoc.data();

    // Migration: Auto-unlock next modules if previous module is completed
    const modules = data.modules || [];
    let needsUpdate = false;

    for (let i = 0; i < modules.length - 1; i++) {
      const currentModule = modules[i];
      const nextModule = modules[i + 1];

      // If current module is completed and next module is locked, unlock it
      if (currentModule.status === 'completed' && !nextModule.unlocked) {
        console.log(`🔧 Migration: Unlocking ${nextModule.id} because ${currentModule.id} is completed`);
        nextModule.unlocked = true;
        nextModule.status = 'not_started';
        if (nextModule.sections && nextModule.sections.length > 0) {
          nextModule.sections[0].unlocked = true;
        }
        needsUpdate = true;
      }
    }

    // Save migration changes
    if (needsUpdate) {
      await updateDoc(dashboardRef, {
        modules,
        lastUpdatedAt: new Date().toISOString()
      });
      console.log('✅ Dashboard state migrated and updated');
      return { ...data, modules };
    }

    return data;
  } catch (error) {
    console.error('❌ Error getting dashboard state:', error);
    throw error;
  }
}

/**
 * Get specific section data
 */
export async function getSectionData(userId, moduleId, sectionId) {
  try {
    const dashboardState = await getDashboardState(userId);
    if (!dashboardState) return null;

    const module = dashboardState.modules.find(m => m.id === moduleId);
    if (!module) return null;

    const section = module.sections.find(s => s.sectionId === sectionId);
    return section;
  } catch (error) {
    console.error('❌ Error getting section data:', error);
    throw error;
  }
}

/**
 * Mark section as in-progress
 */
export async function startSection(userId, moduleId, sectionId) {
  return updateSectionStatus(userId, moduleId, sectionId, {
    status: 'in_progress',
    startedAt: new Date().toISOString()
  });
}

/**
 * Mark section as completed
 */
export async function completeSection(userId, moduleId, sectionId, data = null) {
  const updates = {
    status: 'completed',
    completedAt: new Date().toISOString()
  };

  if (data) {
    updates.data = data;
  }

  return updateSectionStatus(userId, moduleId, sectionId, updates);
}

/**
 * Add edit to section history
 */
export async function addEditHistory(userId, moduleId, sectionId, field, previousValue, newValue) {
  try {
    const dashboardRef = doc(db, 'dashboards', userId);
    const dashboardDoc = await getDoc(dashboardRef);

    if (!dashboardDoc.exists()) {
      throw new Error('Dashboard not found');
    }

    const dashboardData = dashboardDoc.data();
    const modules = [...dashboardData.modules];
    const moduleIndex = modules.findIndex(m => m.id === moduleId);
    const sectionIndex = modules[moduleIndex].sections.findIndex(s => s.sectionId === sectionId);

    const editEntry = {
      editedAt: new Date().toISOString(),
      field,
      previousValue,
      newValue,
      editedBy: 'user'
    };

    if (!modules[moduleIndex].sections[sectionIndex].metadata.editHistory) {
      modules[moduleIndex].sections[sectionIndex].metadata.editHistory = [];
    }

    modules[moduleIndex].sections[sectionIndex].metadata.editHistory.push(editEntry);

    await updateDoc(dashboardRef, {
      modules,
      lastUpdatedAt: new Date().toISOString()
    });

    console.log('✅ Edit history updated');
    return true;
  } catch (error) {
    console.error('❌ Error adding edit history:', error);
    throw error;
  }
}

/**
 * Initialize dashboard from schema for a new user
 */
export async function initializeDashboard(userId) {
  try {
    const dashboardRef = doc(db, 'dashboards', userId);
    const dashboardDoc = await getDoc(dashboardRef);

    // If dashboard already exists, don't recreate it
    if (dashboardDoc.exists()) {
      console.log('✅ Dashboard already exists');
      return { success: true, alreadyExists: true };
    }

    // Create dashboard from schema
    const dashboardData = {
      ...dashboardSchemaData.dashboard,
      userId,
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString()
    };

    await setDoc(dashboardRef, dashboardData);
    console.log('✅ Dashboard initialized from schema');

    return { success: true, alreadyExists: false };
  } catch (error) {
    console.error('❌ Error initializing dashboard:', error);
    throw error;
  }
}
