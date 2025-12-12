// Module 4: ICP Builder - Multi-step form with state management

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, setDoc } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { getPath } from '../firebase/schema';
import { callNetlifyFunction } from '../utils/apiClient';
import ICPStep1 from './ICPStep1';
import ICPStep2 from './ICPStep2';
import ICPStep3 from './ICPStep3';
import ICPStep4 from './ICPStep4';

export default function ICPBuilder() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    industries: [],
    companySizes: [],
    targetTitles: [],
    territories: []
  });

  // Navigation handlers
  const handleNext = () => {
    setCurrentStep(currentStep + 1);
  };

  const handleBack = () => {
    setCurrentStep(currentStep - 1);
  };

  // Form submission handler
  const handleSubmit = async () => {
    const user = auth.currentUser;
    if (!user) {
      console.error('No authenticated user');
      return;
    }

    // Validate all fields
    if (
      formData.industries.length === 0 ||
      formData.companySizes.length === 0 ||
      formData.targetTitles.length === 0 ||
      formData.territories.length === 0
    ) {
      console.error('All fields are required');
      return;
    }

    setIsSubmitting(true);

    try {
      // Save to Firestore: users/{userId}/icp
      const icpPath = getPath.userICP(user.uid);
      const icpRef = doc(db, icpPath);

      const icpData = {
        industries: formData.industries,
        companySizes: formData.companySizes,
        targetTitles: formData.targetTitles,
        territories: formData.territories,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await setDoc(icpRef, icpData);

      console.log('ICP data saved successfully');

      // Module 5: Generate ICP Brief using Netlify function
      try {
        const briefResult = await callNetlifyFunction('generateICPBrief', {
          userId: user.uid,
          icpData: icpData
        });

        console.log('ICP brief generated successfully');

        // Save brief to Firestore: users/{userId}/icpBrief
        const briefPath = getPath.userICPBrief(user.uid);
        const briefRef = doc(db, briefPath);

        await setDoc(briefRef, {
          text: briefResult.text,
          generatedAt: briefResult.generatedAt,
          icpData: icpData
        });

        console.log('ICP brief saved to Firestore');

        // Redirect to ICP brief view
        navigate('/icp-brief');
      } catch (briefError) {
        console.error('Error generating ICP brief:', briefError);
        // Still navigate to dashboard on brief generation error
        alert('ICP data saved, but failed to generate brief. You can try again from the dashboard.');
        navigate('/dashboard');
      }
    } catch (error) {
      console.error('Error saving ICP data:', error);
      alert('Failed to save ICP data. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Render current step
  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <ICPStep1
            selectedIndustries={formData.industries}
            onSelect={(industries) => setFormData({ ...formData, industries })}
            onNext={handleNext}
            onBack={null}
          />
        );
      case 2:
        return (
          <ICPStep2
            selectedSizes={formData.companySizes}
            onSelect={(companySizes) => setFormData({ ...formData, companySizes })}
            onNext={handleNext}
            onBack={handleBack}
          />
        );
      case 3:
        return (
          <ICPStep3
            selectedTitles={formData.targetTitles}
            onSelect={(targetTitles) => setFormData({ ...formData, targetTitles })}
            onNext={handleNext}
            onBack={handleBack}
          />
        );
      case 4:
        return (
          <ICPStep4
            selectedTerritories={formData.territories}
            onSelect={(territories) => setFormData({ ...formData, territories })}
            onSubmit={handleSubmit}
            onBack={handleBack}
            isSubmitting={isSubmitting}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div>
      {/* Progress indicator */}
      <div className="fixed top-0 left-0 right-0 bg-black/80 backdrop-blur-sm z-10">
        <div className="max-w-4xl mx-auto px-8 py-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm text-gray-400">ICP Builder</div>
            <div className="text-sm text-gray-400">Step {currentStep} of 4</div>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-cyan-400 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(currentStep / 4) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Current step content */}
      <div className="pt-20">
        {renderStep()}
      </div>
    </div>
  );
}
