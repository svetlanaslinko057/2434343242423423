import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRealtimeEvents, useRealtimeSetup } from '../hooks/useRealtime';
import { useToast } from './Toast';

/**
 * Executor Realtime Bridge
 * Handles real-time events for developers with action buttons
 */
export function ExecutorRealtimeBridge({ userId, onRefresh }) {
  const { toast } = useToast();
  const navigate = useNavigate();

  useRealtimeSetup(userId, 'developer');

  useRealtimeEvents({
    'workunit.assigned': (payload) => {
      toast.success('New task assigned', {
        description: payload.title || 'A new task is waiting for you',
        actionLabel: 'View Task',
        onAction: () => navigate(`/developer/work/${payload.unit_id}`),
      });
      onRefresh?.();
    },
    
    'workunit.revision_requested': (payload) => {
      toast.error('Revision required', {
        description: payload.title || 'Your submission needs changes',
        actionLabel: 'View Feedback',
        onAction: () => navigate(`/developer/work/${payload.unit_id}`),
      });
      onRefresh?.();
    },
    
    'submission.reviewed': (payload) => {
      if (payload.result === 'approved') {
        toast.success('Task approved!', {
          description: payload.feedback || 'Great work! Moving to validation.',
        });
      } else {
        toast.warning('Changes requested', {
          description: payload.feedback || 'Please review the feedback',
          actionLabel: 'View Details',
          onAction: () => navigate(`/developer/work/${payload.unit_id}`),
        });
      }
      onRefresh?.();
    },

    'payment.completed': (payload) => {
      toast.success('Payment received!', {
        description: `Payment confirmed for ${payload.project_name || 'your project'}`,
      });
      onRefresh?.();
    },
  });

  return null;
}

/**
 * Tester Realtime Bridge
 */
export function TesterRealtimeBridge({ userId, onRefresh }) {
  const { toast } = useToast();
  const navigate = useNavigate();

  useRealtimeSetup(userId, 'tester');

  useRealtimeEvents({
    'validation.created': (payload) => {
      toast.warning('New validation task', {
        description: payload.title || 'A task is ready for testing',
        actionLabel: 'Start Testing',
        onAction: () => navigate(`/tester/validation/${payload.validation_id}`),
      });
      onRefresh?.();
    },
    
    'validation.reopened': (payload) => {
      toast.info('Validation reopened', {
        description: 'Task has been resubmitted for testing',
        actionLabel: 'Review',
        onAction: () => navigate(`/tester/validation/${payload.validation_id}`),
      });
      onRefresh?.();
    },
  });

  return null;
}

/**
 * Client Realtime Bridge — FULL LIFECYCLE
 */
export function ClientRealtimeBridge({ userId, projectIds = [], onRefresh }) {
  const { toast } = useToast();
  const navigate = useNavigate();

  useRealtimeSetup(userId, 'client', projectIds.map(id => `project:${id}`));

  useRealtimeEvents({
    // Request lifecycle
    'request.updated': (payload) => {
      toast.info('Request updated', {
        description: payload.message || 'Your request has been reviewed',
        actionLabel: 'View',
        onAction: () => navigate('/client/dashboard'),
      });
      onRefresh?.();
    },

    'proposal.ready': (payload) => {
      toast.success('Proposal ready!', {
        description: `Your project proposal is ready for review`,
        actionLabel: 'View Proposal',
        onAction: () => navigate(`/client/project/${payload.project_id}`),
        duration: 8000,
      });
      onRefresh?.();
    },

    'request.rejected': (payload) => {
      toast.error('Request declined', {
        description: payload.reason || 'Your request has been reviewed',
        actionLabel: 'View Details',
        onAction: () => navigate('/client/dashboard'),
      });
      onRefresh?.();
    },

    // Deliverable lifecycle
    'deliverable.created': (payload) => {
      toast.success('New deliverable ready!', {
        description: `${payload.title || 'Delivery'} ${payload.version || ''} is ready for review`,
        actionLabel: 'Review Delivery',
        onAction: () => navigate(`/client/deliverable/${payload.deliverable_id}`),
        duration: 8000,
      });
      onRefresh?.();
    },

    'deliverable.ready_for_payment': (payload) => {
      toast.success('Deliverable approved!', {
        description: 'Your deliverable has been approved and is ready for payment',
        actionLabel: 'Pay Now',
        onAction: () => navigate(`/client/deliverable/${payload.deliverable_id}`),
        duration: 10000,
      });
      onRefresh?.();
    },

    'deliverable.unlocked': (payload) => {
      toast.success('Content unlocked!', {
        description: `${payload.title || 'Deliverable'} is now available for download`,
        actionLabel: 'Download',
        onAction: () => navigate(`/client/deliverable/${payload.deliverable_id}`),
        duration: 8000,
      });
      onRefresh?.();
    },

    // Payment lifecycle
    'invoice.created': (payload) => {
      toast.warning('New invoice', {
        description: `Invoice for $${payload.amount || '0'} is ready`,
        actionLabel: 'View Invoice',
        onAction: () => navigate(`/client/project/${payload.project_id}`),
      });
      onRefresh?.();
    },

    'payment.completed': (payload) => {
      toast.success('Payment confirmed!', {
        description: `Payment for ${payload.project_name || 'your project'} has been processed`,
        duration: 8000,
      });
      onRefresh?.();
    },
    
    // Project lifecycle
    'project.updated': (payload) => {
      toast.info('Project updated', {
        description: payload.message || `${payload.name || 'Your project'} has been updated`,
        actionLabel: 'View Project',
        onAction: () => navigate(`/client/project/${payload.project_id}`),
      });
      onRefresh?.();
    },
    
    'project.stage_changed': (payload) => {
      toast.success('Project milestone!', {
        description: `Project moved to ${payload.stage} stage`,
        actionLabel: 'View Timeline',
        onAction: () => navigate(`/client/project/${payload.project_id}`),
      });
      onRefresh?.();
    },
    
    'support.updated': (payload) => {
      toast.info('Support response', {
        description: 'Your support ticket has been updated',
        actionLabel: 'View Response',
        onAction: () => navigate('/client/support'),
      });
      onRefresh?.();
    },
  });

  return null;
}

/**
 * Admin Realtime Bridge — FULL SYSTEM CONTROL
 */
export function AdminRealtimeBridge({ userId, onRefresh }) {
  const { toast } = useToast();
  const navigate = useNavigate();

  useRealtimeSetup(userId, 'admin');

  useRealtimeEvents({
    // New client requests
    'request.created': (payload) => {
      toast.info('New client request', {
        description: payload.title || 'A new project request has arrived',
        actionLabel: 'Review',
        onAction: () => navigate('/admin/dashboard'),
      });
      onRefresh?.();
    },

    // Submissions
    'submission.created': (payload) => {
      toast.warning('New submission', {
        description: `${payload.title || 'Task'} submitted for review`,
        actionLabel: 'Review Now',
        onAction: () => navigate('/admin/control-center'),
      });
      onRefresh?.();
    },
    
    // Validation results
    'validation.failed': (payload) => {
      toast.error('Validation failed', {
        description: payload.title || 'A task failed QA validation',
        actionLabel: 'View Details',
        onAction: () => navigate('/admin/control-center'),
      });
      onRefresh?.();
    },
    
    'validation.passed': (payload) => {
      toast.success('Validation passed', {
        description: payload.title || 'Task passed QA',
      });
      onRefresh?.();
    },

    // Project events
    'project.approved': (payload) => {
      toast.success('Project approved', {
        description: `${payload.name || 'Project'} has been approved by client`,
        actionLabel: 'View Project',
        onAction: () => navigate(`/admin/project/${payload.project_id}`),
      });
      onRefresh?.();
    },

    'proposal.changes_requested': (payload) => {
      toast.warning('Changes requested', {
        description: `Client requested changes to proposal`,
        actionLabel: 'Review',
        onAction: () => navigate(`/admin/project/${payload.project_id}`),
      });
      onRefresh?.();
    },

    // Deliverable events
    'deliverable.approved': (payload) => {
      toast.success('Deliverable approved', {
        description: `${payload.title || 'Deliverable'} has been approved`,
      });
      onRefresh?.();
    },

    'deliverable.rejected': (payload) => {
      toast.error('Deliverable rejected', {
        description: payload.reason || 'Client rejected the deliverable',
        actionLabel: 'View',
        onAction: () => navigate('/admin/control-center'),
      });
      onRefresh?.();
    },

    // Payment events  
    'payment.completed': (payload) => {
      toast.success('Payment received!', {
        description: `$${payload.amount || '0'} received for ${payload.project_name || 'project'}`,
        duration: 8000,
      });
      onRefresh?.();
    },

    // System alerts
    'alert.created': (payload) => {
      toast.error('System Alert', {
        description: payload.message || 'Critical issue detected',
        actionLabel: 'Investigate',
        onAction: () => navigate('/admin/control-center'),
        duration: 10000,
      });
      onRefresh?.();
    },
    
    'project.risk_changed': (payload) => {
      if (payload.risk === 'high') {
        toast.error('High risk project', {
          description: `${payload.name || 'Project'} needs attention`,
          actionLabel: 'View Project',
          onAction: () => navigate(`/admin/project/${payload.project_id}`),
        });
      }
      onRefresh?.();
    },

    // System Mode events
    'system.mode_changed': (payload) => {
      const modeLabels = { manual: 'Manual', assisted: 'Assisted', auto: 'Auto' };
      toast.info(`System mode: ${modeLabels[payload.mode] || payload.mode}`, {
        description: `System switched to ${modeLabels[payload.mode] || payload.mode} mode`,
        duration: 5000,
      });
      onRefresh?.();
    },

    'system.action_pending': (payload) => {
      toast.warning('Action awaiting approval', {
        description: payload.label || `${payload.action_type} needs your approval`,
        actionLabel: 'Review',
        onAction: () => navigate('/admin/control-center'),
      });
      onRefresh?.();
    },

    'system.action_executed': (payload) => {
      toast.success('Action executed', {
        description: `${payload.action_type?.replace('_', ' ')} completed (${payload.mode})`,
      });
      onRefresh?.();
    },

    'system.critical_blocked': (payload) => {
      toast.error('Critical action blocked!', {
        description: payload.label || `${payload.action_type} requires manual approval`,
        actionLabel: 'Override',
        onAction: () => navigate('/admin/control-center'),
        duration: 15000,
      });
      onRefresh?.();
    },

    // Learning events
    'learning.candidate_detected': (payload) => {
      toast.info('Template candidate found!', {
        description: `${payload.project_title} (margin: ${payload.margin}%) ready for review`,
        actionLabel: 'Review',
        onAction: () => navigate('/admin/control-center'),
        duration: 10000,
      });
      onRefresh?.();
    },

    'learning.candidate_approved': (payload) => {
      toast.success('New template created!', {
        description: `${payload.template_name} saved to template library`,
        actionLabel: 'View Templates',
        onAction: () => navigate('/admin/templates'),
      });
      onRefresh?.();
    },
  });

  return null;
}

export default ExecutorRealtimeBridge;
